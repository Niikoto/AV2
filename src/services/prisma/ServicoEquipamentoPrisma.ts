import { randomUUID } from 'node:crypto';
import { EquipamentoRepository } from '../../repositories/EquipamentoRepository.js';
import { LoteRepository } from '../../repositories/LoteRepository.js';
import { MovimentacaoRepository } from '../../repositories/MovimentacaoRepository.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { EstadoFisico, StatusLote, StatusRastreamento, TipoEquipamento } from '../../generated/prisma/enums.js';
import { ServicoLotePrisma } from './ServicoLotePrisma.js';
import { ServicoAuditoriaPrisma } from './ServicoAuditoriaPrisma.js';

type DadosNovoEquipamento = Omit<Prisma.EquipamentoUncheckedCreateInput, 'loteId' | 'posicaoNoLote'>;

export class ServicoEquipamentoPrisma {
  constructor(
    private prisma: PrismaClient,
    private servicoLote = new ServicoLotePrisma(prisma),
  ) {}

  adicionarAoLote(loteId: string, dados: DadosNovoEquipamento, responsavel = 'sistema') {
    return this.servicoLote.adicionarEquipamentoLote(loteId, dados, responsavel);
  }

  async consultarEquipamento(identificador: string) {
    const equipamentos = new EquipamentoRepository(this.prisma);
    const equipamento = await equipamentos.buscarPorId(identificador)
      ?? await equipamentos.buscarPorCodigoBarras(identificador);
    if (!equipamento) throw new Error('Equipamento não encontrado por ID ou código de barras.');
    return equipamento;
  }

  async listarEquipamentos(filtros: {
    loteId?: string;
    status?: StatusRastreamento;
    incluirCancelados?: boolean;
  } = {}) {
    const where: Prisma.EquipamentoWhereInput = {
      ...(filtros.loteId ? { loteId: filtros.loteId } : {}),
      ...(filtros.status ? { statusRastreamento: filtros.status } : {}),
      ...(filtros.incluirCancelados ? {} : { cancelado: false }),
    };
    return new EquipamentoRepository(this.prisma).listar(where);
  }

  async atualizarEquipamento(id: string, dados: {
    marca?: string;
    modelo?: string;
    anoFabricacao?: number;
    pesoQuilogramas?: number;
  }, responsavel = 'sistema') {
    return this.prisma.$transaction(async (tx) => {
      const equipamentos = new EquipamentoRepository(tx);
      const equipamento = await equipamentos.buscarComMovimentacoes(id);
      if (!equipamento) throw new Error('Equipamento não encontrado por ID ou código de barras.');
      this.exigirEquipamentoAtivo(equipamento.cancelado);
      const lote = await new LoteRepository(tx).buscarComEquipamentos(equipamento.loteId);
      if (!lote) throw new Error('Lote associado ao equipamento não encontrado.');
      if (lote.cancelado
        || lote.statusProcessamento !== StatusLote.RECEBIDO
        || equipamento.statusRastreamento !== StatusRastreamento.AGUARDANDO_TRIAGEM
        || equipamento.movimentacoes.length > 0) {
        throw new Error('Só é possível editar dados cadastrais antes da triagem e de qualquer movimentação.');
      }

      if (dados.marca !== undefined && !dados.marca.trim()) throw new Error('A marca é obrigatória.');
      if (dados.modelo !== undefined && !dados.modelo.trim()) throw new Error('O modelo é obrigatório.');
      if (dados.anoFabricacao !== undefined
        && (!Number.isInteger(dados.anoFabricacao)
          || dados.anoFabricacao < 1900
          || dados.anoFabricacao > new Date().getFullYear())) {
        throw new Error('O ano de fabricação é inválido.');
      }
      if (dados.pesoQuilogramas !== undefined
        && (!Number.isFinite(dados.pesoQuilogramas) || dados.pesoQuilogramas <= 0)) {
        throw new Error('O peso deve ser maior que zero.');
      }

      const atualizacao: Prisma.EquipamentoUncheckedUpdateInput = {};
      if (dados.marca !== undefined) atualizacao.marca = dados.marca.trim();
      if (dados.modelo !== undefined) atualizacao.modelo = dados.modelo.trim();
      if (dados.anoFabricacao !== undefined) atualizacao.anoFabricacao = dados.anoFabricacao;
      if (dados.pesoQuilogramas !== undefined) atualizacao.pesoQuilogramas = dados.pesoQuilogramas;
      await this.atualizarVersionado(tx, id, equipamento.version, atualizacao);
      const atualizado = await equipamentos.buscarPorId(id);
      if (!atualizado) throw new Error('Equipamento não encontrado após atualização.');
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'ATUALIZAR',
        entidade: 'equipamento',
        dadosAntes: { id, marca: equipamento.marca, modelo: equipamento.modelo },
        dadosDepois: { id, marca: atualizado.marca, modelo: atualizado.modelo },
        usuarioResponsavel: responsavel,
      });
      return atualizado;
    });
  }

  async atualizarStatusRastreamento(
    id: string,
    novoStatus: StatusRastreamento,
    responsavel: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const equipamentos = new EquipamentoRepository(tx);
      const equipamento = await equipamentos.buscarPorId(id)
        ?? await equipamentos.buscarPorCodigoBarras(id);
      if (!equipamento) throw new Error('Equipamento não encontrado por ID ou código de barras.');
      this.exigirEquipamentoAtivo(equipamento.cancelado);
      const lote = await new LoteRepository(tx).buscarPorId(equipamento.loteId);
      if (!lote) throw new Error('Lote associado ao equipamento não encontrado.');
      if (lote.cancelado) throw new Error('O lote está cancelado e não aceita operações nos equipamentos.');
      if (novoStatus === equipamento.statusRastreamento) throw new Error('O equipamento já está neste status.');
      if (equipamento.statusRastreamento === StatusRastreamento.BAIXA_DEFINITIVA) {
        throw new Error('Um equipamento com baixa definitiva não pode mudar de status.');
      }

      const destinosFinais: StatusRastreamento[] = [
        StatusRastreamento.PECAS_REAPROVEITADAS,
        StatusRastreamento.MATERIAL_RECICLAVEL,
        StatusRastreamento.DESCARTE_SEGURO,
      ];
      const permitido = equipamento.statusRastreamento === StatusRastreamento.AGUARDANDO_DESMONTE
        ? novoStatus === StatusRastreamento.EM_DESMONTE
          && lote.statusProcessamento === StatusLote.TRIAGEM_CONCLUIDA
        : equipamento.statusRastreamento === StatusRastreamento.EM_DESMONTE
          ? destinosFinais.includes(novoStatus)
          : destinosFinais.includes(equipamento.statusRastreamento)
            && novoStatus === StatusRastreamento.BAIXA_DEFINITIVA;
      if (!permitido) {
        throw new Error('Transição de status inválida. Siga a sequência triagem, desmontagem, destinação e baixa definitiva.');
      }

      await this.atualizarVersionado(tx, equipamento.id, equipamento.version, {
        statusRastreamento: novoStatus,
      });
      await new MovimentacaoRepository(tx).criar({
        id: randomUUID(),
        equipamentoId: equipamento.id,
        origem: equipamento.statusRastreamento,
        destino: novoStatus,
        responsavel,
        observacao: `Mudança de status: ${equipamento.statusRastreamento} -> ${novoStatus}`,
        tipoEvento: 'STATUS',
      });
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'ALTERAR_STATUS',
        entidade: 'equipamento',
        dadosAntes: { id: equipamento.id, status: equipamento.statusRastreamento },
        dadosDepois: { id: equipamento.id, status: novoStatus },
        usuarioResponsavel: responsavel,
      });
    });
  }

  async atualizarEstadoFisico(
    id: string,
    novoEstado: EstadoFisico,
    justificativa = '',
    responsavel = 'sistema',
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const equipamentos = new EquipamentoRepository(tx);
      const equipamento = await equipamentos.buscarPorId(id)
        ?? await equipamentos.buscarPorCodigoBarras(id);
      if (!equipamento) throw new Error('Equipamento não encontrado por ID ou código de barras.');
      this.exigirEquipamentoAtivo(equipamento.cancelado);
      const lote = await new LoteRepository(tx).buscarPorId(equipamento.loteId);
      if (!lote) throw new Error('Lote associado ao equipamento não encontrado.');
      if (lote.cancelado) throw new Error('O lote está cancelado e não aceita operações nos equipamentos.');
      if (lote.statusProcessamento !== StatusLote.RECEBIDO
        || equipamento.statusRastreamento !== StatusRastreamento.AGUARDANDO_TRIAGEM) {
        throw new Error('O estado físico só pode ser corrigido antes da conclusão da triagem.');
      }

      const ordem: Record<EstadoFisico, number> = {
        [EstadoFisico.NOVO]: 0,
        [EstadoFisico.BOM_ESTADO]: 1,
        [EstadoFisico.USADO_LEVE]: 2,
        [EstadoFisico.USADO_MODERADO]: 3,
        [EstadoFisico.DANIFICADO_LEVE]: 4,
        [EstadoFisico.DANIFICADO_GRAVE]: 5,
        [EstadoFisico.INSERVIVEL]: 6,
      };
      if (ordem[novoEstado] - ordem[equipamento.estadoFisico] >= 2 && !justificativa.trim()) {
        throw new Error('Justificativa obrigatória para degradar o estado físico em duas ou mais categorias.');
      }

      await this.atualizarVersionado(tx, equipamento.id, equipamento.version, {
        estadoFisico: novoEstado,
      });
      await new MovimentacaoRepository(tx).criar({
        id: randomUUID(),
        equipamentoId: equipamento.id,
        origem: equipamento.estadoFisico,
        destino: novoEstado,
        responsavel,
        observacao: justificativa.trim(),
        tipoEvento: 'ESTADO_FISICO',
      });
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'ALTERAR_ESTADO_FISICO',
        entidade: 'equipamento',
        dadosAntes: { id: equipamento.id, estadoFisico: equipamento.estadoFisico },
        dadosDepois: { id: equipamento.id, estadoFisico: novoEstado },
        usuarioResponsavel: responsavel,
      });
    });
  }

  async registrarMovimentacao(id: string, destino: string, responsavel: string): Promise<void> {
    if (!destino.trim()) throw new Error('O destino da movimentação é obrigatório.');
    await this.prisma.$transaction(async (tx) => {
      const equipamentos = new EquipamentoRepository(tx);
      const equipamento = await equipamentos.buscarComMovimentacoes(id)
        ?? await this.buscarPorCodigoComMovimentacoes(tx, id);
      if (!equipamento) throw new Error('Equipamento não encontrado por ID ou código de barras.');
      this.exigirEquipamentoAtivo(equipamento.cancelado);
      const lote = await new LoteRepository(tx).buscarPorId(equipamento.loteId);
      if (!lote) throw new Error('Lote associado ao equipamento não encontrado.');
      if (lote.cancelado) throw new Error('O lote está cancelado e não aceita operações nos equipamentos.');

      const origem = this.obterLocalAtual(equipamento.movimentacoes) || 'RECEBIMENTO';
      await this.atualizarVersionado(tx, equipamento.id, equipamento.version, {});
      await new MovimentacaoRepository(tx).criar({
        id: randomUUID(),
        equipamentoId: equipamento.id,
        origem,
        destino: destino.trim(),
        responsavel,
        observacao: `Movimentação registrada para ${equipamento.id}`,
        tipoEvento: 'MOVIMENTACAO',
      });
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'MOVIMENTAR',
        entidade: 'equipamento',
        dadosAntes: { id: equipamento.id, localizacao: origem },
        dadosDepois: { id: equipamento.id, localizacao: destino.trim() },
        usuarioResponsavel: responsavel,
      });
    });
  }

  async corrigirMovimentacao(
    identificador: string,
    movimentacaoId: string,
    novoDestino: string,
    responsavel: string,
    justificativa: string,
  ): Promise<void> {
    if (!novoDestino.trim() || !justificativa.trim()) {
      throw new Error('Informe o novo destino e a justificativa da correção.');
    }
    await this.prisma.$transaction(async (tx) => {
      const equipamento = await this.buscarComMovimentacoes(tx, identificador);
      if (!equipamento) throw new Error('Equipamento não encontrado por ID ou código de barras.');
      this.exigirEquipamentoAtivo(equipamento.cancelado);
      const original = equipamento.movimentacoes.find((item) => item.id === movimentacaoId);
      if (!original || original.tipoEvento !== 'MOVIMENTACAO') {
        throw new Error('Movimentação original não encontrada.');
      }
      if (equipamento.movimentacoes.some((item) => item.movimentacaoReferenciadaId === movimentacaoId)) {
        throw new Error('Esta movimentação já possui evento de correção ou estorno.');
      }

      const localAtual = this.obterLocalAtual(equipamento.movimentacoes);
      await this.atualizarVersionado(tx, equipamento.id, equipamento.version, {});
      await new MovimentacaoRepository(tx).criar({
        id: randomUUID(),
        equipamentoId: equipamento.id,
        origem: localAtual,
        destino: localAtual,
        responsavel,
        observacao: justificativa.trim(),
        tipoEvento: 'CORRECAO',
        movimentacaoReferenciadaId: movimentacaoId,
        destinoCorrigido: novoDestino.trim(),
      });
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'CORRIGIR_MOVIMENTACAO',
        entidade: 'equipamento',
        dadosAntes: { id: equipamento.id, movimentacaoId, destino: localAtual },
        dadosDepois: { id: equipamento.id, movimentacaoId, destino: novoDestino.trim() },
        usuarioResponsavel: responsavel,
      });
    });
  }

  async estornarMovimentacao(
    identificador: string,
    movimentacaoId: string,
    responsavel: string,
    justificativa: string,
  ): Promise<void> {
    if (!justificativa.trim()) throw new Error('Informe a justificativa do estorno.');
    await this.prisma.$transaction(async (tx) => {
      const equipamento = await this.buscarComMovimentacoes(tx, identificador);
      if (!equipamento) throw new Error('Equipamento não encontrado por ID ou código de barras.');
      this.exigirEquipamentoAtivo(equipamento.cancelado);
      const movimentacoes = equipamento.movimentacoes;
      const indiceOriginal = movimentacoes.findIndex((item) => (
        item.id === movimentacaoId && item.tipoEvento === 'MOVIMENTACAO'
      ));
      if (indiceOriginal < 0) throw new Error('Movimentação original não encontrada.');
      if (movimentacoes.some((item) => item.movimentacaoReferenciadaId === movimentacaoId)) {
        throw new Error('Esta movimentação já possui evento de correção ou estorno.');
      }
      const houveMovimentacaoPosterior = movimentacoes.slice(indiceOriginal + 1)
        .some((item) => item.tipoEvento === 'MOVIMENTACAO' || item.tipoEvento === 'ESTORNO');
      if (houveMovimentacaoPosterior) {
        throw new Error('Só é possível estornar a movimentação física mais recente; use correção para registrar ajuste histórico.');
      }

      const original = movimentacoes[indiceOriginal];
      await this.atualizarVersionado(tx, equipamento.id, equipamento.version, {});
      await new MovimentacaoRepository(tx).criar({
        id: randomUUID(),
        equipamentoId: equipamento.id,
        origem: original.destino,
        destino: original.origem,
        responsavel,
        observacao: justificativa.trim(),
        tipoEvento: 'ESTORNO',
        movimentacaoReferenciadaId: movimentacaoId,
      });
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'ESTORNAR_MOVIMENTACAO',
        entidade: 'equipamento',
        dadosAntes: { id: equipamento.id, movimentacaoId, destino: original.destino },
        dadosDepois: { id: equipamento.id, movimentacaoId, destino: original.origem },
        usuarioResponsavel: responsavel,
      });
    });
  }

  async rastrearEquipamento(identificador: string) {
    const equipamentoPorId = await this.prisma.equipamento.findUnique({
      where: { id: identificador },
      include: {
        lote: {
          include: {
            organizacao: {
              include: { contratos: true, contratoVigente: true },
            },
          },
        },
        movimentacoes: { orderBy: [{ dataHora: 'asc' }, { id: 'asc' }] },
      },
    });
    const equipamento = equipamentoPorId ?? await this.prisma.equipamento.findUnique({
      where: { codigoBarrasInterno: identificador },
      include: {
        lote: {
          include: {
            organizacao: {
              include: { contratos: true, contratoVigente: true },
            },
          },
        },
        movimentacoes: { orderBy: [{ dataHora: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!equipamento) throw new Error('Equipamento não encontrado por ID ou código de barras.');

    const contratos = equipamento.lote.organizacao.contratos;
    const movimentacoes = equipamento.movimentacoes;
    const linhaDoTempo: Array<{
      dataHora: Date;
      tipo: string;
      descricao: string;
      responsavel?: string;
      eventoId?: string;
    }> = [
      {
        dataHora: equipamento.lote.organizacao.dataCadastro,
        tipo: 'ORGANIZACAO',
        descricao: `Organização ${equipamento.lote.organizacao.razaoSocial} cadastrada`,
        eventoId: equipamento.lote.organizacao.id,
      },
      ...contratos.flatMap((contrato) => [
        {
          dataHora: contrato.dataAssinatura,
          tipo: 'CONTRATO',
          descricao: `Contrato ${contrato.id} assinado`,
          eventoId: contrato.id,
        },
        ...this.eventosRenovacao(contrato.historicoRenovacoes, contrato.id),
        ...(contrato.encerradoEm
          ? [{
            dataHora: contrato.encerradoEm,
            tipo: 'ENCERRAMENTO_CONTRATO',
            descricao: `Contrato ${contrato.id} encerrado`,
            eventoId: contrato.id,
          }]
          : []),
      ]),
      {
        dataHora: equipamento.lote.dataEntrada,
        tipo: 'LOTE',
        descricao: `Lote ${equipamento.lote.id} recebido pela organização ${equipamento.lote.organizacaoId}`,
        eventoId: equipamento.lote.id,
      },
      ...(equipamento.dataCadastro
        ? [{
          dataHora: equipamento.dataCadastro,
          tipo: 'EQUIPAMENTO',
          descricao: `Equipamento ${equipamento.id} cadastrado no lote ${equipamento.loteId}`,
          eventoId: equipamento.id,
        }]
        : []),
      ...movimentacoes.map((evento) => ({
        dataHora: evento.dataHora,
        tipo: evento.tipoEvento,
        descricao: this.descreverMovimentacao(evento),
        responsavel: evento.responsavel,
        eventoId: evento.id,
      })),
    ].sort((primeiro, segundo) => (
      primeiro.dataHora.getTime() - segundo.dataHora.getTime()
      || (primeiro.eventoId ?? '').localeCompare(segundo.eventoId ?? '')
    ));

    return {
      equipamento,
      lote: equipamento.lote,
      organizacao: equipamento.lote.organizacao,
      movimentacoes,
      localizacaoAtual: this.obterLocalAtual(movimentacoes),
      linhaDoTempo,
    };
  }

  calcularDepreciacao(equipamento: {
    anoFabricacao: number;
    pesoQuilogramas: number;
  }, coeficienteDepreciacao = 0.08): number {
    if (!Number.isFinite(coeficienteDepreciacao) || coeficienteDepreciacao < 0 || coeficienteDepreciacao > 1) {
      throw new Error('O coeficiente de depreciação deve estar entre 0 e 1.');
    }
    const anos = Math.max(0, new Date().getFullYear() - equipamento.anoFabricacao);
    return Number((equipamento.pesoQuilogramas * anos * coeficienteDepreciacao).toFixed(2));
  }

  async cancelarEquipamento(id: string, motivo: string, responsavel = 'sistema'): Promise<void> {
    if (!motivo.trim()) throw new Error('Informe o motivo do cancelamento do equipamento.');
    await this.prisma.$transaction(async (tx) => {
      const equipamentos = new EquipamentoRepository(tx);
      const equipamento = await equipamentos.buscarPorId(id)
        ?? await equipamentos.buscarPorCodigoBarras(id);
      if (!equipamento) throw new Error('Equipamento não encontrado por ID ou código de barras.');
      this.exigirEquipamentoAtivo(equipamento.cancelado);
      const lote = await new LoteRepository(tx).buscarPorId(equipamento.loteId);
      if (!lote) throw new Error('Lote associado ao equipamento não encontrado.');
      if (lote.cancelado) throw new Error('O lote está cancelado e não aceita operações nos equipamentos.');

      await this.atualizarVersionado(tx, equipamento.id, equipamento.version, {
        cancelado: true,
        motivoCancelamento: motivo.trim(),
      });
      await new MovimentacaoRepository(tx).criar({
        id: randomUUID(),
        equipamentoId: equipamento.id,
        origem: equipamento.statusRastreamento,
        destino: equipamento.statusRastreamento,
        responsavel,
        observacao: `Cadastro cancelado. Motivo: ${motivo.trim()}`,
        tipoEvento: 'CANCELAMENTO',
      });
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, {
        operacao: 'CANCELAR',
        entidade: 'equipamento',
        dadosAntes: { id: equipamento.id, cancelado: false },
        dadosDepois: { id: equipamento.id, cancelado: true, motivo: motivo.trim() },
        usuarioResponsavel: responsavel,
      });
    });
  }

  async gerarCodigoBarras(tipo: TipoEquipamento, sequencia: number): Promise<string> {
    if (!Number.isInteger(sequencia) || sequencia <= 0) {
      throw new Error('A sequência do código de barras deve ser um inteiro positivo.');
    }
    let candidato = sequencia;
    let codigo = this.formatarCodigoBarras(tipo, candidato);
    while (await new EquipamentoRepository(this.prisma).buscarPorCodigoBarras(codigo)) {
      candidato += 1;
      codigo = this.formatarCodigoBarras(tipo, candidato);
    }
    return codigo;
  }

  private async buscarPorCodigoComMovimentacoes(
    tx: Prisma.TransactionClient,
    codigoBarrasInterno: string,
  ) {
    const equipamento = await new EquipamentoRepository(tx).buscarPorCodigoBarras(codigoBarrasInterno);
    if (!equipamento) return null;
    return tx.equipamento.findUnique({
      where: { id: equipamento.id },
      include: { movimentacoes: { orderBy: [{ dataHora: 'asc' }, { id: 'asc' }] } },
    });
  }

  private buscarComMovimentacoes(
    tx: Prisma.TransactionClient,
    identificador: string,
  ) {
    return tx.equipamento.findUnique({
      where: { id: identificador },
      include: { movimentacoes: { orderBy: [{ dataHora: 'asc' }, { id: 'asc' }] } },
    }).then(async (equipamento) => {
      if (equipamento) return equipamento;
      const porCodigo = await tx.equipamento.findUnique({
        where: { codigoBarrasInterno: identificador },
        include: { movimentacoes: { orderBy: [{ dataHora: 'asc' }, { id: 'asc' }] } },
      });
      return porCodigo;
    });
  }

  private obterLocalAtual(movimentacoes: Array<{
    id: string;
    dataHora: Date;
    destino: string;
    tipoEvento: string;
    movimentacaoReferenciadaId: string | null;
    destinoCorrigido: string | null;
  }>): string {
    const fisicas = movimentacoes
      .filter((movimentacao) => movimentacao.tipoEvento === 'MOVIMENTACAO' || movimentacao.tipoEvento === 'ESTORNO')
      .sort((primeira, segunda) => primeira.dataHora.getTime() - segunda.dataHora.getTime());
    const ultima = fisicas.at(-1);
    if (!ultima) return '';
    return movimentacoes.find((evento) => (
      evento.tipoEvento === 'CORRECAO' && evento.movimentacaoReferenciadaId === ultima.id
    ))?.destinoCorrigido ?? ultima.destino;
  }

  private exigirEquipamentoAtivo(cancelado: boolean): void {
    if (cancelado) throw new Error('O equipamento está cancelado e não aceita novas operações.');
  }

  private async atualizarVersionado(
    tx: Prisma.TransactionClient,
    id: string,
    version: number,
    dados: Prisma.EquipamentoUncheckedUpdateManyInput,
  ): Promise<void> {
    const atualizacao = await tx.equipamento.updateMany({
      where: { id, version, cancelado: false },
      data: { ...dados, version: { increment: 1 } },
    });
    if (atualizacao.count !== 1) {
      throw new Error('Conflito de atualização no equipamento. Recarregue os dados e tente novamente.');
    }
  }

  private formatarCodigoBarras(tipo: TipoEquipamento, sequencia: number): string {
    return `GC-${tipo}-${sequencia.toString().padStart(6, '0')}`;
  }

  private eventosRenovacao(
    historico: Prisma.JsonValue,
    contratoId: string,
  ): Array<{ dataHora: Date; tipo: string; descricao: string; eventoId: string }> {
    if (!Array.isArray(historico)) return [];
    return historico.flatMap((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
      const vencimento = item.dataVencimentoNovo;
      const registrado = item.registradoEm;
      if (typeof vencimento !== 'string' || typeof registrado !== 'string') return [];
      const dataHora = new Date(registrado);
      if (Number.isNaN(dataHora.getTime())) return [];
      return [{
        dataHora,
        tipo: 'RENOVACAO_CONTRATO',
        descricao: `Contrato ${contratoId} renovado até ${new Date(vencimento).toISOString()}`,
        eventoId: contratoId,
      }];
    });
  }

  private descreverMovimentacao(evento: {
    id: string;
    origem: string;
    destino: string;
    observacao: string;
    tipoEvento: string;
    movimentacaoReferenciadaId: string | null;
    destinoCorrigido: string | null;
  }): string {
    if (evento.tipoEvento === 'CORRECAO') {
      return `Correção da movimentação ${evento.movimentacaoReferenciadaId}: destino correto ${evento.destinoCorrigido}. ${evento.observacao}`;
    }
    if (evento.tipoEvento === 'ESTORNO') {
      return `Estorno da movimentação ${evento.movimentacaoReferenciadaId}: ${evento.origem} -> ${evento.destino}. ${evento.observacao}`;
    }
    if (evento.tipoEvento === 'STATUS') {
      return `${evento.observacao} (${evento.origem} -> ${evento.destino})`;
    }
    if (evento.tipoEvento === 'ESTADO_FISICO' || evento.tipoEvento === 'CANCELAMENTO') {
      return evento.observacao;
    }
    return `${evento.origem} -> ${evento.destino}. ${evento.observacao}`;
  }
}
