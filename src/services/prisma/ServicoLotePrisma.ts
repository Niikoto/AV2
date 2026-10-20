import { LoteRepository } from '../../repositories/LoteRepository.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { EstadoFisico } from '../../generated/prisma/enums.js';
import { StatusLote } from '../../generated/prisma/enums.js';
import { StatusRastreamento } from '../../generated/prisma/enums.js';
import { TipoEquipamento } from '../../generated/prisma/enums.js';
import { ValidadorDataEntrada } from '../../validators/ValidadorDataEntrada.js';
import { EquipamentoRepository } from '../../repositories/EquipamentoRepository.js';
import { ServicoAuditoriaPrisma } from './ServicoAuditoriaPrisma.js';

type OpcoesCriarLote = {
  id: string;
  dataEntrada: Date;
  organizacaoId: string;
  notaFiscal: string;
  transportadora: string;
  observacoes?: string;
};

type OpcoesCriarEquipamento = Omit<
  Prisma.EquipamentoUncheckedCreateInput,
  | 'loteId'
  | 'posicaoNoLote'
  | 'statusRastreamento'
  | 'cancelado'
  | 'motivoCancelamento'
  | 'dataCadastro'
  | 'version'
>;

export class ServicoLotePrisma {
  constructor(
    private prisma: PrismaClient,
    private validadorDataEntrada = new ValidadorDataEntrada(),
  ) {}

  async criarLoteComEquipamentos(
    dados: OpcoesCriarLote,
    equipamentosDados: OpcoesCriarEquipamento[],
    responsavel = 'sistema',
  ) {
    if (!this.validadorDataEntrada.validar(dados.dataEntrada)) {
      throw new Error(this.validadorDataEntrada.obterMensagemErro());
    }
    if (!dados.id.trim() || !dados.notaFiscal.trim() || !dados.transportadora.trim()) {
      throw new Error('Identificador, nota fiscal e transportadora são obrigatórios.');
    }
    if (equipamentosDados.length === 0) {
      throw new Error('O lote deve conter ao menos um equipamento.');
    }
    equipamentosDados.forEach((equipamento) => this.validarDadosEquipamento(equipamento));
    const codigos = equipamentosDados.map((equipamento) => equipamento.codigoBarrasInterno.trim());
    if (new Set(codigos).size !== codigos.length) {
      throw new Error('O lote contém códigos de barras duplicados.');
    }

    return this.prisma.$transaction(async (tx) => {
      const organizacao = await tx.organizacao.findUnique({
        where: { id: dados.organizacaoId },
        select: { id: true, ativo: true, version: true },
      });
      if (!organizacao) throw new Error('Não é possível criar lote para uma organização inexistente.');
      if (!organizacao.ativo) throw new Error('Não é possível criar lote para uma organização desativada.');
      const reservaOrganizacao = await tx.organizacao.updateMany({
        where: { id: organizacao.id, version: organizacao.version, ativo: true },
        data: { version: { increment: 1 } },
      });
      if (reservaOrganizacao.count !== 1) {
        throw new Error('Conflito de atualização na organização. Recarregue os dados e tente novamente.');
      }
      const lote = await new LoteRepository(tx).criar({
        id: dados.id.trim(),
        dataEntrada: dados.dataEntrada,
        organizacaoId: dados.organizacaoId,
        notaFiscal: dados.notaFiscal.trim(),
        transportadora: dados.transportadora.trim(),
        observacoes: dados.observacoes?.trim() ?? '',
      });
      const equipamentos = [];
      for (const [indice, dadosEquipamento] of equipamentosDados.entries()) {
        equipamentos.push(await new EquipamentoRepository(tx).criar({
          ...dadosEquipamento,
          codigoBarrasInterno: dadosEquipamento.codigoBarrasInterno.trim(),
          loteId: lote.id,
          posicaoNoLote: indice + 1,
          statusRastreamento: StatusRastreamento.AGUARDANDO_TRIAGEM,
        }));
      }
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'CRIAR_LOTE_COM_EQUIPAMENTOS',
        entidade: 'lote',
        dadosDepois: {
          id: lote.id,
          organizacaoId: lote.organizacaoId,
          equipamentos: equipamentos.map(({ id }) => id),
        },
        usuarioResponsavel: responsavel,
      });
      return { ...lote, equipamentos };
    });
  }

  async criarLote(dados: OpcoesCriarLote, responsavel = 'sistema') {
    if (!this.validadorDataEntrada.validar(dados.dataEntrada)) {
      throw new Error(this.validadorDataEntrada.obterMensagemErro());
    }
    if (!dados.id.trim() || !dados.notaFiscal.trim() || !dados.transportadora.trim()) {
      throw new Error('Identificador, nota fiscal e transportadora são obrigatórios.');
    }

    return this.prisma.$transaction(async (tx) => {
      const organizacao = await tx.organizacao.findUnique({
        where: { id: dados.organizacaoId },
        select: { id: true, ativo: true, version: true },
      });
      if (!organizacao) throw new Error('Não é possível criar lote para uma organização inexistente.');
      if (!organizacao.ativo) throw new Error('Não é possível criar lote para uma organização desativada.');
      const reservaOrganizacao = await tx.organizacao.updateMany({
        where: { id: organizacao.id, version: organizacao.version, ativo: true },
        data: { version: { increment: 1 } },
      });
      if (reservaOrganizacao.count !== 1) {
        throw new Error('Conflito de atualização na organização. Recarregue os dados e tente novamente.');
      }

      const lote = await new LoteRepository(tx).criar({
        id: dados.id.trim(),
        dataEntrada: dados.dataEntrada,
        organizacaoId: dados.organizacaoId,
        notaFiscal: dados.notaFiscal.trim(),
        transportadora: dados.transportadora.trim(),
        observacoes: dados.observacoes?.trim() ?? '',
      });
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'CRIAR',
        entidade: 'lote',
        dadosDepois: { id: lote.id, organizacaoId: lote.organizacaoId },
        usuarioResponsavel: responsavel,
      });
      return lote;
    });
  }

  async adicionarEquipamentoLote(loteId: string, dados: OpcoesCriarEquipamento, responsavel = 'sistema') {
    return this.prisma.$transaction(async (tx) => {
      const loteAtual = await tx.lote.findUnique({ where: { id: loteId } });
      if (!loteAtual) throw new Error('Lote não encontrado.');
      const reserva = await tx.lote.updateMany({
        where: {
          id: loteId,
          version: loteAtual.version,
          cancelado: false,
          statusProcessamento: StatusLote.RECEBIDO,
        },
        data: { version: { increment: 1 } },
      });
      if (reserva.count !== 1) {
        throw new Error('Conflito de atualização no lote. Recarregue os dados e tente novamente.');
      }
      const lotes = new LoteRepository(tx);
      const equipamentos = new EquipamentoRepository(tx);
      const lote = await lotes.buscarComEquipamentos(loteId);
      if (!lote) throw new Error('Lote não encontrado.');
      this.exigirLoteAtivo(lote.cancelado);
      if (lote.statusProcessamento !== StatusLote.RECEBIDO) {
        throw new Error('Não é possível adicionar equipamento após o início da triagem.');
      }
      this.validarDadosEquipamento(dados);

      const duplicado = await equipamentos.buscarPorCodigoBarras(dados.codigoBarrasInterno);
      if (duplicado) throw new Error('Já existe um equipamento com este código de barras.');

      const equipamento = await equipamentos.criar({
        ...dados,
        loteId,
        posicaoNoLote: lote.equipamentos.length + 1,
        statusRastreamento: StatusRastreamento.AGUARDANDO_TRIAGEM,
      });
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'CRIAR',
        entidade: 'equipamento',
        dadosDepois: { id: equipamento.id, loteId, codigoBarrasInterno: equipamento.codigoBarrasInterno },
        usuarioResponsavel: responsavel,
      });
      return equipamento;
    });
  }

  async processarTriagem(loteId: string, responsavel = 'sistema'): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const loteAtual = await tx.lote.findUnique({ where: { id: loteId } });
      if (!loteAtual) throw new Error('Lote não encontrado.');
      const reserva = await tx.lote.updateMany({
        where: {
          id: loteId,
          version: loteAtual.version,
          cancelado: false,
          statusProcessamento: StatusLote.RECEBIDO,
        },
        data: { version: { increment: 1 } },
      });
      if (reserva.count !== 1) {
        throw new Error('Conflito de atualização no lote. Recarregue os dados e tente novamente.');
      }
      const lotes = new LoteRepository(tx);
      const lote = await lotes.buscarComEquipamentos(loteId);
      if (!lote) throw new Error('Lote não encontrado.');
      this.exigirLoteAtivo(lote.cancelado);
      if (lote.statusProcessamento !== StatusLote.RECEBIDO) {
        throw new Error('A triagem só pode ser concluída uma vez, a partir de um lote recebido.');
      }
      if (lote.equipamentos.length === 0) {
        throw new Error('Não é possível concluir a triagem de um lote sem equipamentos.');
      }
      if (lote.equipamentos.some((equipamento) => equipamento.cancelado)) {
        throw new Error('Não é possível concluir a triagem enquanto o lote contém equipamento cancelado.');
      }
      if (lote.equipamentos.some((equipamento) => equipamento.statusRastreamento !== StatusRastreamento.AGUARDANDO_TRIAGEM)) {
        throw new Error('Todos os equipamentos precisam estar aguardando triagem para concluir esta etapa.');
      }

      const atualizacaoEquipamentos = await tx.equipamento.updateMany({
        where: { loteId, cancelado: false, statusRastreamento: StatusRastreamento.AGUARDANDO_TRIAGEM },
        data: {
          statusRastreamento: StatusRastreamento.AGUARDANDO_DESMONTE,
          version: { increment: 1 },
        },
      });
      if (atualizacaoEquipamentos.count !== lote.equipamentos.length) {
        throw new Error('Conflito ao processar os equipamentos do lote. Recarregue os dados e tente novamente.');
      }
      await lotes.atualizar(loteId, { statusProcessamento: StatusLote.TRIAGEM_CONCLUIDA });
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'CONCLUIR_TRIAGEM',
        entidade: 'lote',
        dadosAntes: { id: loteId, statusProcessamento: lote.statusProcessamento },
        dadosDepois: { id: loteId, statusProcessamento: StatusLote.TRIAGEM_CONCLUIDA },
        usuarioResponsavel: responsavel,
      });
    });
  }

  buscarLote(id: string) {
    return new LoteRepository(this.prisma).buscarComEquipamentos(id).then((lote) => {
      if (!lote) throw new Error('Lote não encontrado.');
      return lote;
    });
  }

  async listarLotes(filtros: {
    organizacaoId?: string;
    dataInicio?: Date;
    dataFim?: Date;
    status?: StatusLote;
    incluirCancelados?: boolean;
  } = {}) {
    if (filtros.dataInicio && Number.isNaN(filtros.dataInicio.getTime())) {
      throw new Error('A data inicial do filtro é inválida.');
    }
    if (filtros.dataFim && Number.isNaN(filtros.dataFim.getTime())) {
      throw new Error('A data final do filtro é inválida.');
    }
    if (filtros.dataInicio && filtros.dataFim && filtros.dataInicio > filtros.dataFim) {
      throw new Error('A data inicial não pode ser posterior à data final.');
    }

    const where: Prisma.LoteWhereInput = {
      ...(filtros.organizacaoId ? { organizacaoId: filtros.organizacaoId } : {}),
      ...(filtros.status ? { statusProcessamento: filtros.status } : {}),
      ...(filtros.incluirCancelados ? {} : { cancelado: false }),
      ...(filtros.dataInicio || filtros.dataFim
        ? {
          dataEntrada: {
            ...(filtros.dataInicio ? { gte: filtros.dataInicio } : {}),
            ...(filtros.dataFim ? { lte: filtros.dataFim } : {}),
          },
        }
        : {}),
    };

    return new LoteRepository(this.prisma).listar(where);
  }

  async atualizarLote(id: string, dados: {
    dataEntrada?: Date;
    notaFiscal?: string;
    transportadora?: string;
    observacoes?: string;
  }, responsavel = 'sistema') {
    return this.prisma.$transaction(async (tx) => {
      const lotes = new LoteRepository(tx);
      const lote = await lotes.buscarComEquipamentos(id);
      if (!lote) throw new Error('Lote não encontrado.');
      this.exigirLoteAtivo(lote.cancelado);
      if (lote.equipamentos.length > 0 || lote.statusProcessamento !== StatusLote.RECEBIDO) {
        throw new Error('Só é possível editar um lote recebido que ainda não tenha equipamentos vinculados.');
      }
      if (dados.dataEntrada && !this.validadorDataEntrada.validar(dados.dataEntrada)) {
        throw new Error(this.validadorDataEntrada.obterMensagemErro());
      }
      if (dados.notaFiscal !== undefined && !dados.notaFiscal.trim()) {
        throw new Error('A nota fiscal é obrigatória.');
      }
      if (dados.transportadora !== undefined && !dados.transportadora.trim()) {
        throw new Error('A transportadora é obrigatória.');
      }

      const atualizacao = await tx.lote.updateMany({
        where: {
          id,
          version: lote.version,
          cancelado: false,
          statusProcessamento: StatusLote.RECEBIDO,
        },
        data: {
          ...(dados.dataEntrada ? { dataEntrada: dados.dataEntrada } : {}),
          ...(dados.notaFiscal !== undefined ? { notaFiscal: dados.notaFiscal.trim() } : {}),
          ...(dados.transportadora !== undefined ? { transportadora: dados.transportadora.trim() } : {}),
          ...(dados.observacoes !== undefined ? { observacoes: dados.observacoes.trim() } : {}),
          version: { increment: 1 },
        },
      });
      if (atualizacao.count !== 1) {
        throw new Error('Conflito de atualização no lote. Recarregue os dados e tente novamente.');
      }
      const atualizado = await lotes.buscarPorId(id);
      if (!atualizado) throw new Error('Lote não encontrado após atualização.');
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'ATUALIZAR',
        entidade: 'lote',
        dadosAntes: { id },
        dadosDepois: { id: atualizado.id },
        usuarioResponsavel: responsavel,
      });
      return atualizado;
    });
  }

  async cancelarLote(loteId: string, motivo: string, responsavel = 'sistema'): Promise<void> {
    if (!motivo.trim()) throw new Error('Informe o motivo do cancelamento do lote.');
    await this.prisma.$transaction(async (tx) => {
      const lotes = new LoteRepository(tx);
      const lote = await lotes.buscarComEquipamentos(loteId);
      if (!lote) throw new Error('Lote não encontrado.');
      this.exigirLoteAtivo(lote.cancelado);
      if (lote.equipamentos.some((equipamento) => !equipamento.cancelado)) {
        throw new Error('Cancele os equipamentos ainda ativos antes de cancelar o lote.');
      }
      const atualizacao = await tx.lote.updateMany({
        where: { id: loteId, version: lote.version, cancelado: false },
        data: {
          cancelado: true,
          motivoCancelamento: motivo.trim(),
          version: { increment: 1 },
        },
      });
      if (atualizacao.count !== 1) {
        throw new Error('Conflito de atualização no lote. Recarregue os dados e tente novamente.');
      }
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'CANCELAR',
        entidade: 'lote',
        dadosAntes: { id: loteId, cancelado: false },
        dadosDepois: { id: loteId, motivo: motivo.trim() },
        usuarioResponsavel: responsavel,
      });
    });
  }

  private exigirLoteAtivo(cancelado: boolean): void {
    if (cancelado) throw new Error('O lote está cancelado e não aceita novas operações.');
  }

  private validarDadosEquipamento(dados: OpcoesCriarEquipamento): void {
    if (!dados.id.trim() || !dados.codigoBarrasInterno.trim()) {
      throw new Error('Identificador e código de barras do equipamento são obrigatórios.');
    }
    if (!dados.marca.trim() || !dados.modelo.trim()) throw new Error('Marca e modelo são obrigatórios.');
    if (!Number.isInteger(dados.anoFabricacao)
      || dados.anoFabricacao < 1900
      || dados.anoFabricacao > new Date().getFullYear()) {
      throw new Error('O ano de fabricação é inválido.');
    }
    if (!Number.isFinite(dados.pesoQuilogramas) || dados.pesoQuilogramas <= 0) {
      throw new Error('O peso deve ser maior que zero.');
    }
    if (!(dados.tipo in TipoEquipamento) || !(dados.estadoFisico in EstadoFisico)) {
      throw new Error('Tipo ou estado físico do equipamento inválido.');
    }
  }
}
