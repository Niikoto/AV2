import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { RepositorioArquivo } from '../infra/RepositorioArquivo.js';
import { Credencial } from '../session/Credencial.js';
import { Sessao } from '../session/Sessao.js';
import { PapelUsuario } from '../types/PapelUsuario.js';

export type AcaoProtegida =
  | 'GERENCIAR_CREDENCIAIS'
  | 'GERENCIAR_PARAMETROS_GLOBAIS'
  | 'GERENCIAR_ORGANIZACOES'
  | 'GERENCIAR_CONTRATOS'
  | 'GERENCIAR_LOTES'
  | 'TRIAR_EQUIPAMENTOS'
  | 'GERENCIAR_EQUIPAMENTOS'
  | 'CONSULTAR_HISTORICOS'
  | 'GERAR_RELATORIOS';

export interface CredencialPublica {
  id: string;
  usuario: string;
  nomeExibicao: string;
  papel: PapelUsuario;
  ativo: boolean;
  ultimoAcesso: Date;
}

export class ServicoAutenticacao {
  public credenciais: Credencial[];
  public sessoesAtivas: Sessao[] = [];

  constructor(private repositorio: RepositorioArquivo) {
    this.credenciais = this.carregarCredenciais();
  }

  criarCredencial(
    usuario: string,
    senha: string,
    papel: PapelUsuario,
    nomeExibicao = usuario,
    tokenAdministrador?: string,
  ): Credencial {
    const usuarioNormalizado = usuario.trim();
    const nomeNormalizado = nomeExibicao.trim();

    if (!usuarioNormalizado) {
      throw new Error('O usuário é obrigatório.');
    }

    if (!senha) {
      throw new Error('A senha é obrigatória.');
    }

    if (!nomeNormalizado) {
      throw new Error('O nome de exibição é obrigatório.');
    }

    this.credenciais = this.carregarCredenciais();
    const existemContasAtivas = this.credenciais.some((credencial) => credencial.ativo);
    if (existemContasAtivas) {
      if (!tokenAdministrador) throw new Error('A criação de contas exige uma sessão administrativa.');
      this.exigirPermissao(tokenAdministrador, 'GERENCIAR_CREDENCIAIS');
    } else if (papel !== PapelUsuario.ADMINISTRADOR) {
      throw new Error('A primeira conta do sistema deve ser um administrador.');
    }
    if (this.credenciais.some((credencial) => credencial.ativo && credencial.usuario === usuarioNormalizado)) {
      throw new Error('Já existe uma credencial para este usuário.');
    }

    const salt = randomBytes(16).toString('hex');
    const credencial = new Credencial(
      usuarioNormalizado,
      this.calcularHashSenha(senha, salt),
      salt,
      new Date(),
      papel,
      nomeNormalizado,
    );

    this.repositorio.salvarEntidade('credenciais', credencial);
    this.credenciais.push(credencial);

    return credencial;
  }

  login(usuario: string, senha: string): Sessao {
    this.credenciais = this.carregarCredenciais();
    const credencial = this.credenciais.find((item) => item.ativo && item.usuario === usuario);

    if (!credencial || !credencial.verificarSenha(senha)) {
      throw new Error('Usuário ou senha inválidos.');
    }

    credencial.atualizarUltimoAcesso();
    this.repositorio.definirUsuarioResponsavel(credencial.id);
    this.repositorio.salvarEntidade('credenciais', credencial);

    const agora = new Date();
    const sessao = new Sessao(
      randomUUID(),
      credencial.usuario,
      credencial.papel,
      agora,
      new Date(agora.getTime() + 30 * 60 * 1000),
      credencial.id,
    );

    this.sessoesAtivas.push(sessao);
    return sessao;
  }

  logout(token: string): void {
    this.sessoesAtivas = this.sessoesAtivas.filter((sessao) => sessao.token !== token);
  }

  validarToken(token: string): boolean {
    const sessao = this.sessoesAtivas.find((item) => item.token === token);

    if (!sessao || !sessao.isValida()) {
      this.logout(token);
      return false;
    }

    this.repositorio.definirUsuarioResponsavel(sessao.usuarioId || sessao.usuario);
    sessao.renovar();
    return true;
  }

  possuiPermissao(token: string, acao: AcaoProtegida): boolean {
    if (!this.validarToken(token)) {
      return false;
    }

    const sessao = this.sessoesAtivas.find((item) => item.token === token);
    return Boolean(sessao && this.papelPossuiPermissao(sessao.papel, acao));
  }

  exigirPermissao(token: string, acao: AcaoProtegida): void {
    if (!this.possuiPermissao(token, acao)) {
      throw new Error('Sessão inválida ou usuário sem permissão para esta operação.');
    }
  }

  alterarSenha(token: string, senhaAntiga: string, senhaNova: string): boolean {
    if (!senhaNova) {
      return false;
    }

    const sessao = this.obterSessaoValida(token);
    if (sessao.papel === PapelUsuario.AUDITOR) {
      throw new Error('Auditores possuem acesso somente para consulta.');
    }
    this.credenciais = this.carregarCredenciais();
    const credencial = this.credenciais.find((item) => item.ativo && item.id === sessao.usuarioId);

    if (!credencial || !credencial.verificarSenha(senhaAntiga)) {
      return false;
    }

    credencial.salt = randomBytes(16).toString('hex');
    credencial.hashSenha = this.calcularHashSenha(senhaNova, credencial.salt);
    credencial.atualizarUltimoAcesso();
    this.repositorio.definirUsuarioResponsavel(credencial.id);
    this.repositorio.salvarEntidade('credenciais', credencial);
    this.invalidarSessoes(credencial.id);

    return true;
  }

  listarCredenciais(tokenAdministrador: string): CredencialPublica[] {
    this.exigirPermissao(tokenAdministrador, 'GERENCIAR_CREDENCIAIS');
    this.credenciais = this.carregarCredenciais();
    return this.credenciais.map((credencial) => ({
      id: credencial.id,
      usuario: credencial.usuario,
      nomeExibicao: credencial.nomeExibicao,
      papel: credencial.papel,
      ativo: credencial.ativo,
      ultimoAcesso: credencial.ultimoAcesso,
    }));
  }

  buscarCredencial(identificador: string, tokenAdministrador: string): CredencialPublica {
    this.exigirPermissao(tokenAdministrador, 'GERENCIAR_CREDENCIAIS');
    this.credenciais = this.carregarCredenciais();
    const credencial = this.credenciais.find((item) => item.id === identificador || item.usuario === identificador);
    if (!credencial) throw new Error('Usuário não encontrado.');
    return {
      id: credencial.id,
      usuario: credencial.usuario,
      nomeExibicao: credencial.nomeExibicao,
      papel: credencial.papel,
      ativo: credencial.ativo,
      ultimoAcesso: credencial.ultimoAcesso,
    };
  }

  alterarNomeExibicao(usuario: string, nomeExibicao: string, tokenAdministrador: string): void {
    this.exigirPermissao(tokenAdministrador, 'GERENCIAR_CREDENCIAIS');
    const credencial = this.buscarCredencialInterna(usuario);
    const nomeNormalizado = nomeExibicao.trim();
    if (!nomeNormalizado) throw new Error('O nome de exibição é obrigatório.');
    credencial.nomeExibicao = nomeNormalizado;
    this.repositorio.definirUsuarioResponsavel(this.usuarioIdDoToken(tokenAdministrador));
    this.repositorio.salvarEntidade('credenciais', credencial);
  }

  alterarPapel(usuario: string, novoPapel: PapelUsuario, tokenAdministrador: string): void {
    this.exigirPermissao(tokenAdministrador, 'GERENCIAR_CREDENCIAIS');
    const credencial = this.buscarCredencialInterna(usuario);
    if (credencial.papel === PapelUsuario.ADMINISTRADOR && novoPapel !== PapelUsuario.ADMINISTRADOR) {
      const administradoresAtivos = this.credenciais.filter(
        (item) => item.ativo && item.papel === PapelUsuario.ADMINISTRADOR,
      ).length;
      if (administradoresAtivos <= 1) throw new Error('Não é permitido remover o papel do último administrador ativo.');
    }
    credencial.papel = novoPapel;
    this.repositorio.definirUsuarioResponsavel(this.usuarioIdDoToken(tokenAdministrador));
    this.repositorio.salvarEntidade('credenciais', credencial);
    this.invalidarSessoes(credencial.id);
  }

  redefinirSenha(usuario: string, senhaNova: string, tokenAdministrador: string): void {
    this.exigirPermissao(tokenAdministrador, 'GERENCIAR_CREDENCIAIS');
    if (!senhaNova) throw new Error('A nova senha é obrigatória.');
    const credencial = this.buscarCredencialInterna(usuario);
    credencial.salt = randomBytes(16).toString('hex');
    credencial.hashSenha = this.calcularHashSenha(senhaNova, credencial.salt);
    credencial.atualizarUltimoAcesso();
    this.repositorio.definirUsuarioResponsavel(this.usuarioIdDoToken(tokenAdministrador));
    this.repositorio.salvarEntidade('credenciais', credencial);
    this.invalidarSessoes(credencial.id);
  }

  desativarCredencial(usuario: string, tokenAdministrador: string): void {
    this.exigirPermissao(tokenAdministrador, 'GERENCIAR_CREDENCIAIS');
    this.credenciais = this.carregarCredenciais();
    const credencial = this.credenciais.find((item) => item.ativo && item.usuario === usuario);

    if (!credencial) {
      throw new Error('Usuário ativo não encontrado.');
    }

    const administradoresAtivos = this.credenciais.filter(
      (item) => item.ativo && item.papel === PapelUsuario.ADMINISTRADOR,
    ).length;
    if (credencial.papel === PapelUsuario.ADMINISTRADOR && administradoresAtivos <= 1) {
      throw new Error('Não é permitido desativar o último administrador ativo.');
    }

    const usuarioId = credencial.id;
    credencial.desativar();
    this.repositorio.definirUsuarioResponsavel(this.usuarioIdDoToken(tokenAdministrador));
    this.repositorio.salvarEntidade('credenciais', credencial);
    this.invalidarSessoes(usuarioId);
    this.credenciais = this.credenciais.filter((item) => item.id !== usuarioId);
  }

  private obterSessaoValida(token: string): Sessao {
    if (!this.validarToken(token)) throw new Error('Sessão inválida ou expirada.');
    const sessao = this.sessoesAtivas.find((item) => item.token === token);
    if (!sessao) throw new Error('Sessão inválida ou expirada.');
    return sessao;
  }

  private usuarioIdDoToken(token: string): string {
    return this.obterSessaoValida(token).usuarioId;
  }

  private invalidarSessoes(usuarioId: string): void {
    this.sessoesAtivas = this.sessoesAtivas.filter((sessao) => sessao.usuarioId !== usuarioId);
  }

  private buscarCredencialInterna(identificador: string): Credencial {
    this.credenciais = this.carregarCredenciais();
    const credencial = this.credenciais.find((item) => item.ativo && (item.usuario === identificador || item.id === identificador));
    if (!credencial) throw new Error('Usuário ativo não encontrado.');
    return credencial;
  }

  private carregarCredenciais(): Credencial[] {
    return this.repositorio.listarEntidades('credenciais').map((dados) => {
      const credencial = new Credencial(
        dados.usuario ?? '',
        dados.hashSenha ?? '',
        dados.salt ?? '',
        new Date(dados.ultimoAcesso),
        dados.papel as PapelUsuario,
        dados.nomeExibicao ?? dados.usuario ?? '',
        dados.id ?? randomUUID(),
        dados.ativo ?? true,
      );

      // Registros anteriores à separação entre login e nome recebem um ID estável e nome padrão.
      if (!dados.id || typeof dados.nomeExibicao !== 'string' || dados.ativo === undefined) {
        this.repositorio.salvarEntidade('credenciais', credencial, dados.id ? undefined : dados.usuario);
      }

      return credencial;
    });
  }

  private calcularHashSenha(senha: string, salt: string): string {
    return createHash('sha256').update(`${salt}:${senha}`, 'utf-8').digest('hex');
  }

  private papelPossuiPermissao(papel: PapelUsuario, acao: AcaoProtegida): boolean {
    if (papel === PapelUsuario.ADMINISTRADOR) {
      return true;
    }

    const permissoesPorPapel: Record<Exclude<PapelUsuario, PapelUsuario.ADMINISTRADOR>, AcaoProtegida[]> = {
      [PapelUsuario.OPERADOR_CADASTRO]: [
        'GERENCIAR_ORGANIZACOES',
        'GERENCIAR_CONTRATOS',
      ],
      [PapelUsuario.GESTOR_ALMOXARIFADO]: [
        'GERENCIAR_LOTES',
        'TRIAR_EQUIPAMENTOS',
        'GERENCIAR_EQUIPAMENTOS',
      ],
      [PapelUsuario.AUDITOR]: [
        'CONSULTAR_HISTORICOS',
        'GERAR_RELATORIOS',
      ],
    };

    return permissoesPorPapel[papel].includes(acao);
  }
}
