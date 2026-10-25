import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { CredencialRepository } from '../../repositories/CredencialRepository.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { PapelUsuario } from '../../generated/prisma/enums.js';
import type { AcaoProtegida } from '../ServicoAutenticacao.js';
import { ServicoAuditoriaPrisma } from './ServicoAuditoriaPrisma.js';

export type CredencialAutenticada = {
  id: string;
  usuario: string;
  nomeExibicao: string;
  papel: PapelUsuario;
};

type CredencialDbClient = Pick<Prisma.TransactionClient, 'credencial'>;

export class ServicoAutenticacaoPrisma {
  constructor(private prisma: PrismaClient) {}

  async criarCredencial(
    usuario: string,
    senha: string,
    papel: PapelUsuario,
    nomeExibicao = usuario,
    administradorId?: string,
  ): Promise<CredencialAutenticada> {
    const usuarioNormalizado = usuario.trim();
    const nomeNormalizado = nomeExibicao.trim();
    if (!usuarioNormalizado) throw new Error('O usuário é obrigatório.');
    if (!senha) throw new Error('A senha é obrigatória.');
    if (!nomeNormalizado) throw new Error('O nome de exibição é obrigatório.');

    return this.prisma.$transaction(async (tx) => {
      const repository = new CredencialRepository(tx);
      const existentes = await repository.listar(true);
      if (existentes.length === 0 && papel !== PapelUsuario.ADMINISTRADOR) {
        throw new Error('A primeira conta do sistema deve ser um administrador.');
      }
      if (existentes.length > 0) await this.exigirAdministrador(tx, administradorId);
      if (existentes.some((credencial) => credencial.usuario === usuarioNormalizado)) {
        throw new Error('Já existe uma credencial para este usuário.');
      }
      const salt = randomBytes(16).toString('hex');
      const credencial = await repository.criar({
        id: randomBytes(16).toString('hex'),
        usuario: usuarioNormalizado,
        nomeExibicao: nomeNormalizado,
        hashSenha: this.calcularHashSenha(senha, salt),
        salt,
        ultimoAcesso: new Date(),
        papel,
      });
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'CRIAR_CREDENCIAL',
        entidade: 'credencial',
        dadosDepois: {
          id: credencial.id,
          usuario: credencial.usuario,
          papel: credencial.papel,
        },
        usuarioResponsavel: administradorId ?? credencial.id,
      });
      return this.publicarCredencial(credencial);
    });
  }

  async autenticar(usuario: string, senha: string): Promise<CredencialAutenticada> {
    const credencial = await new CredencialRepository(this.prisma).buscarPorUsuarioAtivo(usuario);
    if (!credencial || !this.verificarSenha(senha, credencial.salt, credencial.hashSenha)) {
      throw new Error('Usuário ou senha inválidos.');
    }

    const atualizada = await this.prisma.$transaction(async (tx) => {
      const atual = await new CredencialRepository(tx).atualizar(credencial.id, {
        ultimoAcesso: new Date(),
      });
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'LOGIN',
        entidade: 'credencial',
        dadosDepois: { id: credencial.id },
        usuarioResponsavel: credencial.id,
      });
      return atual;
    });
    return this.publicarCredencial(atualizada);
  }

  async buscarCredencialAtiva(id: string): Promise<CredencialAutenticada> {
    const credencial = await new CredencialRepository(this.prisma).buscarPorId(id);
    if (!credencial?.ativo) throw new Error('Usuário ativo não encontrado.');
    return this.publicarCredencial(credencial);
  }

  async listarCredenciais(administradorId: string, nome?: string) {
    await this.exigirAdministrador(this.prisma, administradorId);
    const termo = nome?.trim().toLocaleLowerCase();
    const credenciais = await new CredencialRepository(this.prisma).listar();
    const credenciaisFiltradas = termo
      ? credenciais.filter((credencial) => credencial.ativo && (
        credencial.nomeExibicao.toLocaleLowerCase().includes(termo)
        || credencial.usuario.toLocaleLowerCase().includes(termo)
      ))
      : credenciais;
    return credenciaisFiltradas.map((credencial) => ({
      id: credencial.id,
      usuario: credencial.ativo ? credencial.usuario : '',
      nomeExibicao: credencial.ativo ? credencial.nomeExibicao : '',
      papel: credencial.papel,
      ativo: credencial.ativo,
      ultimoAcesso: credencial.ultimoAcesso,
    }));
  }

  async buscarCredencial(identificador: string, administradorId: string) {
    await this.exigirAdministrador(this.prisma, administradorId);
    const registros = await this.prisma.credencial.findMany({
      where: { OR: [{ id: identificador }, { usuario: identificador }] },
      take: 1,
    });
    const credencial = registros[0];
    if (!credencial) throw new Error('Usuário não encontrado.');
    return {
      id: credencial.id,
      usuario: credencial.ativo ? credencial.usuario : '',
      nomeExibicao: credencial.ativo ? credencial.nomeExibicao : '',
      papel: credencial.papel,
      ativo: credencial.ativo,
      ultimoAcesso: credencial.ultimoAcesso,
    };
  }

  async alterarNomeExibicao(usuario: string, nomeExibicao: string, administradorId: string): Promise<void> {
    const nomeNormalizado = nomeExibicao.trim();
    if (!nomeNormalizado) throw new Error('O nome de exibição é obrigatório.');
    await this.prisma.$transaction(async (tx) => {
      await this.exigirAdministrador(tx, administradorId);
      const credencial = await this.buscarAtivaPorIdentificador(tx, usuario);
      await new CredencialRepository(tx).atualizar(credencial.id, { nomeExibicao: nomeNormalizado });
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'ALTERAR_NOME',
        entidade: 'credencial',
        dadosAntes: { id: credencial.id },
        dadosDepois: { id: credencial.id },
        usuarioResponsavel: administradorId,
      });
    });
  }

  async alterarPapel(usuario: string, novoPapel: PapelUsuario, administradorId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.exigirAdministrador(tx, administradorId);
      const repository = new CredencialRepository(tx);
      const credencial = await this.buscarAtivaPorIdentificador(tx, usuario);
      if (credencial.papel === PapelUsuario.ADMINISTRADOR && novoPapel !== PapelUsuario.ADMINISTRADOR) {
        const administradores = (await repository.listar(true))
          .filter((item) => item.papel === PapelUsuario.ADMINISTRADOR);
        if (administradores.length <= 1) {
          throw new Error('Não é permitido remover o papel do último administrador ativo.');
        }
      }
      await repository.atualizar(credencial.id, { papel: novoPapel });
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'ALTERAR_PAPEL',
        entidade: 'credencial',
        dadosAntes: { id: credencial.id, papel: credencial.papel },
        dadosDepois: { id: credencial.id, papel: novoPapel },
        usuarioResponsavel: administradorId,
      });
    });
  }

  async redefinirSenha(usuario: string, senhaNova: string, administradorId: string): Promise<void> {
    if (!senhaNova) throw new Error('A nova senha é obrigatória.');
    await this.prisma.$transaction(async (tx) => {
      await this.exigirAdministrador(tx, administradorId);
      const credencial = await this.buscarAtivaPorIdentificador(tx, usuario);
      const salt = randomBytes(16).toString('hex');
      await new CredencialRepository(tx).atualizar(credencial.id, {
        salt,
        hashSenha: this.calcularHashSenha(senhaNova, salt),
        ultimoAcesso: new Date(),
      });
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'REDEFINIR_SENHA',
        entidade: 'credencial',
        dadosDepois: { id: credencial.id },
        usuarioResponsavel: administradorId,
      });
    });
  }

  async alterarSenha(usuarioId: string, senhaAntiga: string, senhaNova: string): Promise<boolean> {
    if (!senhaNova) return false;
    return this.prisma.$transaction(async (tx) => {
      const repository = new CredencialRepository(tx);
      const credencial = await repository.buscarPorId(usuarioId);
      if (!credencial?.ativo) throw new Error('Usuário ativo não encontrado.');
      if (credencial.papel === PapelUsuario.AUDITOR) {
        throw new Error('Auditores possuem acesso somente para consulta.');
      }
      if (!this.verificarSenha(senhaAntiga, credencial.salt, credencial.hashSenha)) return false;
      const salt = randomBytes(16).toString('hex');
      await repository.atualizar(usuarioId, {
        salt,
        hashSenha: this.calcularHashSenha(senhaNova, salt),
        ultimoAcesso: new Date(),
      });
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'ALTERAR_SENHA',
        entidade: 'credencial',
        dadosDepois: { id: usuarioId },
        usuarioResponsavel: usuarioId,
      });
      return true;
    });
  }

  async desativarCredencial(usuario: string, administradorId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.exigirAdministrador(tx, administradorId);
      const repository = new CredencialRepository(tx);
      const credencial = await this.buscarAtivaPorIdentificador(tx, usuario);
      if (credencial.papel === PapelUsuario.ADMINISTRADOR) {
        const administradores = (await repository.listar(true))
          .filter((item) => item.papel === PapelUsuario.ADMINISTRADOR);
        if (administradores.length <= 1) {
          throw new Error('Não é permitido desativar o último administrador ativo.');
        }
      }
      const salt = randomBytes(16).toString('hex');
      await repository.atualizar(credencial.id, {
        ativo: false,
        usuario: `__INATIVO__${credencial.id}`,
        nomeExibicao: '',
        salt,
        hashSenha: this.calcularHashSenha(randomBytes(32).toString('hex'), salt),
      });
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'DESATIVAR_CREDENCIAL',
        entidade: 'credencial',
        dadosAntes: { id: credencial.id, ativo: true, papel: credencial.papel },
        dadosDepois: { id: credencial.id, ativo: false, papel: credencial.papel },
        usuarioResponsavel: administradorId,
      });
    });
  }

  async possuiPermissao(usuarioId: string, acao: AcaoProtegida): Promise<boolean> {
    const credencial = await new CredencialRepository(this.prisma).buscarPorId(usuarioId);
    return Boolean(
      credencial?.ativo
      && this.papelPossuiPermissao(credencial.papel, acao),
    );
  }

  async exigirPermissao(usuarioId: string, acao: AcaoProtegida): Promise<void> {
    if (!await this.possuiPermissao(usuarioId, acao)) {
      throw new Error('Usuário não autenticado ou sem permissão para esta operação.');
    }
  }

  private papelPossuiPermissao(papel: PapelUsuario, acao: AcaoProtegida): boolean {
    if (papel === PapelUsuario.ADMINISTRADOR) return true;

    const permissoesPorPapel: Record<
      Exclude<PapelUsuario, typeof PapelUsuario.ADMINISTRADOR>,
      AcaoProtegida[]
    > = {
      [PapelUsuario.OPERADOR_CADASTRO]: ['GERENCIAR_ORGANIZACOES', 'GERENCIAR_CONTRATOS'],
      [PapelUsuario.GESTOR_ALMOXARIFADO]: ['GERENCIAR_LOTES', 'TRIAR_EQUIPAMENTOS', 'GERENCIAR_EQUIPAMENTOS'],
      [PapelUsuario.AUDITOR]: ['CONSULTAR_HISTORICOS', 'GERAR_RELATORIOS'],
    };

    return permissoesPorPapel[papel].includes(acao);
  }

  private verificarSenha(senha: string, salt: string, hashArmazenado: string): boolean {
    if (!hashArmazenado || !salt) return false;
    const hashInformado = Buffer.from(this.calcularHashSenha(senha, salt), 'hex');
    const hashEsperado = Buffer.from(hashArmazenado, 'hex');
    return hashEsperado.length === hashInformado.length && timingSafeEqual(hashEsperado, hashInformado);
  }

  private calcularHashSenha(senha: string, salt: string): string {
    return createHash('sha256').update(`${salt}:${senha}`, 'utf-8').digest('hex');
  }

  private publicarCredencial(credencial: {
    id: string;
    usuario: string;
    nomeExibicao: string;
    papel: PapelUsuario;
  }): CredencialAutenticada {
    return {
      id: credencial.id,
      usuario: credencial.usuario,
      nomeExibicao: credencial.nomeExibicao,
      papel: credencial.papel,
    };
  }

  private async exigirAdministrador(
    prisma: CredencialDbClient,
    administradorId?: string,
  ): Promise<void> {
    if (!administradorId) throw new Error('A operação exige uma sessão administrativa.');
    const credencial = await prisma.credencial.findUnique({
      where: { id: administradorId },
      select: { ativo: true, papel: true },
    });
    if (!credencial?.ativo || credencial.papel !== PapelUsuario.ADMINISTRADOR) {
      throw new Error('Usuário não autenticado ou sem permissão para esta operação.');
    }
  }

  private async buscarAtivaPorIdentificador(
    prisma: CredencialDbClient,
    identificador: string,
  ) {
    const resultados = await prisma.credencial.findMany({
      where: { ativo: true, OR: [{ id: identificador }, { usuario: identificador }] },
      take: 1,
    });
    const credencial = resultados[0];
    if (!credencial) throw new Error('Usuário ativo não encontrado.');
    return credencial;
  }
}
