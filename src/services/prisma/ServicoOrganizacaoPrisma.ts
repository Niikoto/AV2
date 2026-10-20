import { randomUUID } from 'node:crypto';
import { Contrato } from '../../domain/Contrato.js';
import { OrganizacaoRepository } from '../../repositories/OrganizacaoRepository.js';
import { ContratoRepository } from '../../repositories/ContratoRepository.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { ValidadorCNPJ } from '../../validators/ValidadorCNPJ.js';
import { ServicoAuditoriaPrisma } from './ServicoAuditoriaPrisma.js';

type OpcoesCadastroOrganizacao = {
  id: string;
  razaoSocial: string;
  cnpj: string;
  inscricaoEstadual: string;
  enderecoCompleto: string;
  telefone: string;
  email: string;
};

type OpcoesAtualizacaoOrganizacao = Partial<Omit<OpcoesCadastroOrganizacao, 'id' | 'cnpj'>> & {
  cnpj?: string;
};

type OpcoesCadastroContrato = {
  id: string;
  dataAssinatura: Date;
  dataVencimento: Date;
  clausulas?: string[];
  valorMensal: number;
  renovacaoAutomatica?: boolean;
};

export class ServicoOrganizacaoPrisma {
  constructor(
    private prisma: PrismaClient,
    private validadorCNPJ = new ValidadorCNPJ(),
  ) {}

  async cadastrarOrganizacao(dados: OpcoesCadastroOrganizacao, responsavel = 'sistema') {
    this.validarCNPJ(dados.cnpj);
    if (!dados.id.trim() || !dados.razaoSocial.trim()) {
      throw new Error('Identificador e razão social da organização são obrigatórios.');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const organizacoes = new OrganizacaoRepository(tx);
        const cnpjNormalizado = this.normalizarCNPJ(dados.cnpj);
        if (await organizacoes.buscarPorCnpjNormalizado(cnpjNormalizado)) {
          throw new Error('Já existe uma organização cadastrada com este CNPJ.');
        }

        const criada = await organizacoes.criar({
          id: dados.id.trim(),
          razaoSocial: dados.razaoSocial.trim(),
          cnpj: dados.cnpj.trim(),
          cnpjNormalizado,
          inscricaoEstadual: dados.inscricaoEstadual.trim(),
          enderecoCompleto: dados.enderecoCompleto.trim(),
          telefone: dados.telefone.trim(),
          email: dados.email.trim(),
        });
        await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
          operacao: 'CRIAR',
          entidade: 'organizacao',
          dadosDepois: { id: criada.id, cnpj: criada.cnpj },
          usuarioResponsavel: responsavel,
        });
        return criada;
      });
    } catch (error) {
      if (this.conflitoUnicidade(error, 'cnpjNormalizado')) {
        throw new Error('Já existe uma organização cadastrada com este CNPJ.');
      }
      throw error;
    }
  }

  async buscarOrganizacao(id: string) {
    const organizacao = await this.prisma.organizacao.findUnique({
      where: { id },
      include: { contratos: true, contratoVigente: true },
    });
    if (!organizacao) throw new Error('Organização não encontrada.');
    return organizacao;
  }

  listarOrganizacoes(incluirDesativadas = false) {
    return new OrganizacaoRepository(this.prisma).listar(
      incluirDesativadas ? {} : { ativo: true },
    );
  }

  async atualizarOrganizacao(id: string, dados: OpcoesAtualizacaoOrganizacao, responsavel = 'sistema') {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const organizacoes = new OrganizacaoRepository(tx);
        const organizacao = await organizacoes.buscarPorId(id);
        if (!organizacao) throw new Error('Organização não encontrada.');
        if (!organizacao.ativo) throw new Error('Não é possível alterar uma organização desativada.');

        const atualizacao: Prisma.OrganizacaoUncheckedUpdateInput = {};
        if (dados.razaoSocial !== undefined) {
          const razaoSocial = dados.razaoSocial.trim();
          if (!razaoSocial) throw new Error('A razão social é obrigatória.');
          atualizacao.razaoSocial = razaoSocial;
        }
        if (dados.cnpj !== undefined) {
          this.validarCNPJ(dados.cnpj);
          const cnpjNormalizado = this.normalizarCNPJ(dados.cnpj);
          const duplicada = await tx.organizacao.findFirst({
            where: { id: { not: id }, cnpjNormalizado },
          });
          if (duplicada) throw new Error('Já existe uma organização cadastrada com este CNPJ.');
          atualizacao.cnpj = dados.cnpj.trim();
          atualizacao.cnpjNormalizado = cnpjNormalizado;
        }
        if (dados.inscricaoEstadual !== undefined) atualizacao.inscricaoEstadual = dados.inscricaoEstadual.trim();
        if (dados.enderecoCompleto !== undefined) atualizacao.enderecoCompleto = dados.enderecoCompleto.trim();
        if (dados.telefone !== undefined) atualizacao.telefone = dados.telefone.trim();
        if (dados.email !== undefined) atualizacao.email = dados.email.trim();

        const resultado = await tx.organizacao.updateMany({
          where: { id, version: organizacao.version, ativo: true },
          data: { ...atualizacao, version: { increment: 1 } },
        });
        if (resultado.count !== 1) {
          throw new Error('Conflito de atualização na organização. Recarregue os dados e tente novamente.');
        }
        const atualizada = await organizacoes.buscarPorId(id);
        if (!atualizada) throw new Error('Organização não encontrada após atualização.');
        await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
          operacao: 'ATUALIZAR',
          entidade: 'organizacao',
          dadosAntes: { id, cnpj: organizacao.cnpj },
          dadosDepois: { id, cnpj: atualizada.cnpj },
          usuarioResponsavel: responsavel,
        });
        return atualizada;
      });
    } catch (error) {
      if (this.conflitoUnicidade(error, 'cnpjNormalizado')) {
        throw new Error('Já existe uma organização cadastrada com este CNPJ.');
      }
      throw error;
    }
  }

  async desativarOrganizacao(id: string, motivo: string, responsavel = 'sistema'): Promise<void> {
    if (!motivo.trim()) throw new Error('Informe o motivo da desativação da organização.');
    await this.prisma.$transaction(async (tx) => {
      const organizacoes = new OrganizacaoRepository(tx);
      const organizacao = await organizacoes.buscarPorId(id);
      if (!organizacao) throw new Error('Organização não encontrada.');
      if (!organizacao.ativo) throw new Error('A organização já está desativada.');
      const atualizacao = await tx.organizacao.updateMany({
        where: { id, version: organizacao.version, ativo: true },
        data: {
          ativo: false,
          motivoDesativacao: motivo.trim(),
          version: { increment: 1 },
        },
      });
      if (atualizacao.count !== 1) {
        throw new Error('Conflito de atualização na organização. Recarregue os dados e tente novamente.');
      }
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'DESATIVAR',
        entidade: 'organizacao',
        dadosAntes: { id, ativo: true },
        dadosDepois: { id, ativo: false, motivo: motivo.trim() },
        usuarioResponsavel: responsavel,
      });
    });
  }

  async cadastrarContrato(organizacaoId: string, dados: OpcoesCadastroContrato, responsavel = 'sistema') {
    if (!dados.id.trim()) throw new Error('O identificador do contrato é obrigatório.');
    if (!Number.isFinite(dados.valorMensal) || dados.valorMensal < 0) {
      throw new Error('O valor mensal do contrato deve ser um número não negativo.');
    }
    if (!(dados.dataAssinatura instanceof Date) || Number.isNaN(dados.dataAssinatura.getTime())) {
      throw new Error('A data de assinatura do contrato é inválida.');
    }
    if (!(dados.dataVencimento instanceof Date)
      || Number.isNaN(dados.dataVencimento.getTime())
      || dados.dataVencimento <= dados.dataAssinatura) {
      throw new Error('A data de vencimento deve ser posterior à assinatura.');
    }

    return this.prisma.$transaction(async (tx) => {
      const organizacoes = new OrganizacaoRepository(tx);
      const contratos = new ContratoRepository(tx);
      const organizacaoInicial = await organizacoes.buscarPorId(organizacaoId);
      if (!organizacaoInicial) throw new Error('Organização não encontrada.');
      const reserva = await tx.organizacao.updateMany({
        where: { id: organizacaoId, version: organizacaoInicial.version, ativo: true },
        data: { version: { increment: 1 } },
      });
      if (reserva.count !== 1) {
        throw new Error('Conflito de atualização na organização. Recarregue os dados e tente novamente.');
      }
      const organizacao = await organizacoes.buscarPorId(organizacaoId);
      if (!organizacao) throw new Error('Organização não encontrada.');
      if (!organizacao.ativo) throw new Error('Não é possível cadastrar contrato para uma organização desativada.');

      if (organizacao.contratoVigenteId) {
        const vigente = await contratos.buscarPorId(organizacao.contratoVigenteId);
        if (vigente && !vigente.encerradoEm && vigente.dataVencimento >= new Date()) {
          throw new Error('A organização já possui um contrato vigente.');
        }
      }
      if (await contratos.buscarPorId(dados.id.trim())) {
        throw new Error('Já existe um contrato cadastrado com este identificador.');
      }

      const contrato = await contratos.criar({
        id: dados.id.trim(),
        organizacaoId,
        dataAssinatura: dados.dataAssinatura,
        dataVencimento: dados.dataVencimento,
        clausulas: dados.clausulas ?? [],
        valorMensal: dados.valorMensal,
        renovacaoAutomatica: dados.renovacaoAutomatica ?? false,
      });
      const vinculacao = await tx.organizacao.updateMany({
        where: { id: organizacaoId, version: organizacao.version, ativo: true },
        data: { contratoVigenteId: contrato.id, version: { increment: 1 } },
      });
      if (vinculacao.count !== 1) {
        throw new Error('Conflito ao definir o contrato vigente. Recarregue os dados e tente novamente.');
      }
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'CRIAR',
        entidade: 'contrato',
        dadosDepois: { id: contrato.id, organizacaoId },
        usuarioResponsavel: responsavel,
      });
      return contrato;
    });
  }

  listarContratos(organizacaoId: string) {
    return new ContratoRepository(this.prisma).listarPorOrganizacao(organizacaoId);
  }

  async atualizarContrato(
    organizacaoId: string,
    contratoId: string,
    dados: { clausulas?: string[]; valorMensal?: number; renovacaoAutomatica?: boolean },
    responsavel = 'sistema',
  ) {
    return this.prisma.$transaction(async (tx) => {
      const organizacoes = new OrganizacaoRepository(tx);
      const contratos = new ContratoRepository(tx);
      const organizacao = await organizacoes.buscarPorId(organizacaoId);
      if (!organizacao) throw new Error('Organização não encontrada.');
      if (!organizacao.ativo) throw new Error('Não é possível alterar contrato de uma organização desativada.');
      const contrato = await contratos.buscarPorId(contratoId);
      if (!contrato || contrato.organizacaoId !== organizacaoId) {
        throw new Error('Contrato não encontrado para esta organização.');
      }
      if (contrato.encerradoEm) throw new Error('Não é possível alterar um contrato encerrado.');
      if (dados.valorMensal !== undefined && (!Number.isFinite(dados.valorMensal) || dados.valorMensal < 0)) {
        throw new Error('O valor mensal do contrato deve ser um número não negativo.');
      }

      const atualizacao: Prisma.ContratoUncheckedUpdateInput = {};
      if (dados.clausulas !== undefined) atualizacao.clausulas = dados.clausulas;
      if (dados.valorMensal !== undefined) atualizacao.valorMensal = dados.valorMensal;
      if (dados.renovacaoAutomatica !== undefined) atualizacao.renovacaoAutomatica = dados.renovacaoAutomatica;
      const atualizacaoPersistida = await tx.contrato.updateMany({
        where: { id: contratoId, version: contrato.version, encerradoEm: null },
        data: { ...atualizacao, version: { increment: 1 } },
      });
      if (atualizacaoPersistida.count !== 1) {
        throw new Error('Conflito de atualização no contrato. Recarregue os dados e tente novamente.');
      }
      const atualizado = await contratos.buscarPorId(contratoId);
      if (!atualizado) throw new Error('Contrato não encontrado após atualização.');
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'ATUALIZAR',
        entidade: 'contrato',
        dadosAntes: { id: contratoId, valorMensal: contrato.valorMensal },
        dadosDepois: { id: contratoId, valorMensal: atualizado.valorMensal },
        usuarioResponsavel: responsavel,
      });
      return atualizado;
    });
  }

  async renovarContrato(organizacaoId: string, novoVencimento: Date, responsavel = 'sistema') {
    return this.prisma.$transaction(async (tx) => {
      const organizacoes = new OrganizacaoRepository(tx);
      const contratos = new ContratoRepository(tx);
      const organizacao = await organizacoes.buscarPorId(organizacaoId);
      if (!organizacao) throw new Error('Organização não encontrada.');
      if (!organizacao.ativo) throw new Error('Não é possível renovar contrato de uma organização desativada.');
      if (!organizacao.contratoVigenteId) {
        throw new Error('A organização não possui contrato vigente para renovar.');
      }

      const registro = await contratos.buscarPorId(organizacao.contratoVigenteId);
      if (!registro) throw new Error('Contrato vigente não encontrado.');
      const contrato = this.reconstituirContrato(registro);
      contrato.renovar(novoVencimento);
      const atualizacao = await tx.contrato.updateMany({
        where: { id: contrato.id, version: registro.version, encerradoEm: null },
        data: {
          dataVencimento: contrato.dataVencimento,
          historicoRenovacoes: contrato.historicoRenovacoes as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      if (atualizacao.count !== 1) {
        throw new Error('Conflito de renovação do contrato. Recarregue os dados e tente novamente.');
      }
      const renovado = await contratos.buscarPorId(contrato.id);
      if (!renovado) throw new Error('Contrato não encontrado após renovação.');
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'RENOVAR',
        entidade: 'contrato',
        dadosAntes: { id: contrato.id },
        dadosDepois: {
          id: renovado.id,
          dataVencimento: renovado.dataVencimento.toISOString(),
        },
        usuarioResponsavel: responsavel,
      });
      return renovado;
    });
  }

  async encerrarContrato(organizacaoId: string, responsavel = 'sistema'): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const organizacoes = new OrganizacaoRepository(tx);
      const contratos = new ContratoRepository(tx);
      const organizacaoInicial = await organizacoes.buscarPorId(organizacaoId);
      if (!organizacaoInicial) throw new Error('Organização não encontrada.');
      const reserva = await tx.organizacao.updateMany({
        where: { id: organizacaoId, version: organizacaoInicial.version },
        data: { version: { increment: 1 } },
      });
      if (reserva.count !== 1) {
        throw new Error('Conflito de atualização na organização. Recarregue os dados e tente novamente.');
      }
      const organizacao = await organizacoes.buscarPorId(organizacaoId);
      if (!organizacao) throw new Error('Organização não encontrada.');
      if (!organizacao.contratoVigenteId) throw new Error('A organização não possui contrato para encerrar.');
      const contrato = await contratos.buscarPorId(organizacao.contratoVigenteId);
      if (!contrato) throw new Error('Contrato vigente não encontrado.');
      this.reconstituirContrato(contrato).encerrar();
      const encerramento = await tx.contrato.updateMany({
        where: { id: contrato.id, version: contrato.version, encerradoEm: null },
        data: { encerradoEm: new Date(), version: { increment: 1 } },
      });
      if (encerramento.count !== 1) {
        throw new Error('Conflito ao encerrar o contrato. Recarregue os dados e tente novamente.');
      }
      const desvinculacao = await tx.organizacao.updateMany({
        where: {
          id: organizacaoId,
          version: organizacao.version,
          contratoVigenteId: contrato.id,
        },
        data: { contratoVigenteId: null, version: { increment: 1 } },
      });
      if (desvinculacao.count !== 1) {
        throw new Error('Conflito ao remover o contrato vigente. Recarregue os dados e tente novamente.');
      }
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'ENCERRAR',
        entidade: 'contrato',
        dadosAntes: { id: contrato.id, encerradoEm: null },
        dadosDepois: { id: contrato.id },
        usuarioResponsavel: responsavel,
      });
    });
  }

  async cancelarContrato(organizacaoId: string, contratoId: string, responsavel = 'sistema'): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const organizacoes = new OrganizacaoRepository(tx);
      const contratos = new ContratoRepository(tx);
      const organizacaoInicial = await organizacoes.buscarPorId(organizacaoId);
      if (!organizacaoInicial) throw new Error('Organização não encontrada.');
      const reserva = await tx.organizacao.updateMany({
        where: { id: organizacaoId, version: organizacaoInicial.version },
        data: { version: { increment: 1 } },
      });
      if (reserva.count !== 1) {
        throw new Error('Conflito de atualização na organização. Recarregue os dados e tente novamente.');
      }
      const organizacao = await organizacoes.buscarPorId(organizacaoId);
      if (!organizacao) throw new Error('Organização não encontrada.');
      const contrato = await contratos.buscarPorId(contratoId);
      if (!contrato || contrato.organizacaoId !== organizacaoId) {
        throw new Error('Contrato não encontrado para esta organização.');
      }
      this.reconstituirContrato(contrato).encerrar();
      const encerramento = await tx.contrato.updateMany({
        where: { id: contratoId, version: contrato.version, encerradoEm: null },
        data: { encerradoEm: new Date(), version: { increment: 1 } },
      });
      if (encerramento.count !== 1) {
        throw new Error('Conflito ao encerrar o contrato. Recarregue os dados e tente novamente.');
      }
      if (organizacao.contratoVigenteId === contratoId) {
        const desvinculacao = await tx.organizacao.updateMany({
          where: {
            id: organizacaoId,
            version: organizacao.version,
            contratoVigenteId: contratoId,
          },
          data: { contratoVigenteId: null, version: { increment: 1 } },
        });
        if (desvinculacao.count !== 1) {
          throw new Error('Conflito ao remover o contrato vigente. Recarregue os dados e tente novamente.');
        }
      }
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'CANCELAR',
        entidade: 'contrato',
        dadosAntes: { id: contratoId, encerradoEm: contrato.encerradoEm },
        dadosDepois: { id: contratoId },
        usuarioResponsavel: responsavel,
      });
    });
  }

  private validarCNPJ(cnpj: string): void {
    if (!this.validadorCNPJ.validar(cnpj)) {
      throw new Error(this.validadorCNPJ.obterMensagemErro());
    }
  }

  private normalizarCNPJ(cnpj: string): string {
    return cnpj.replace(/\D/g, '');
  }

  private conflitoUnicidade(error: unknown, campo: string): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'P2002') {
      return false;
    }
    if (!('meta' in error) || typeof error.meta !== 'object' || error.meta === null) return false;
    if (!('target' in error.meta)) return false;
    const target = error.meta.target;
    return Array.isArray(target) ? target.includes(campo) : String(target).includes(campo);
  }

  private reconstituirContrato(registro: {
    id: string;
    organizacaoId: string;
    dataAssinatura: Date;
    dataVencimento: Date;
    clausulas: string[];
    valorMensal: number;
    renovacaoAutomatica: boolean;
    encerradoEm: Date | null;
    historicoRenovacoes: Prisma.JsonValue;
  }): Contrato {
    const renovacoes = Array.isArray(registro.historicoRenovacoes)
      ? registro.historicoRenovacoes.flatMap((item) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
        const anterior = item.dataVencimentoAnterior;
        const novo = item.dataVencimentoNovo;
        const registrado = item.registradoEm;
        if (typeof anterior !== 'string' || typeof novo !== 'string' || typeof registrado !== 'string') return [];
        return [{
          dataVencimentoAnterior: new Date(anterior),
          dataVencimentoNovo: new Date(novo),
          registradoEm: new Date(registrado),
        }];
      })
      : [];

    return new Contrato(
      registro.id,
      registro.organizacaoId,
      registro.dataAssinatura,
      registro.dataVencimento,
      registro.clausulas,
      registro.valorMensal,
      registro.renovacaoAutomatica,
      registro.encerradoEm,
      renovacoes,
    );
  }
}
