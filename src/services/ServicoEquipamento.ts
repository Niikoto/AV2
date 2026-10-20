import { Equipamento } from '../domain/Equipamento.js';
import { Contrato } from '../domain/Contrato.js';
import { Lote } from '../domain/Lote.js';
import { Movimentacao } from '../domain/Movimentacao.js';
import { Organizacao } from '../domain/Organizacao.js';
import { RepositorioArquivo } from '../infra/RepositorioArquivo.js';
import { EstadoFisico } from '../types/EstadoFisico.js';
import { StatusLote } from '../types/StatusLote.js';
import { StatusRastreamento } from '../types/StatusRastreamento.js';
import { TipoEquipamento } from '../types/TipoEquipamento.js';
import { randomUUID } from 'node:crypto';

export interface HistoricoCompleto {
  equipamento: Equipamento;
  lote: Lote;
  organizacao: Organizacao;
  movimentacoes: Movimentacao[];
  localizacaoAtual: string;
  linhaDoTempo: Array<{ dataHora: Date; tipo: string; descricao: string; responsavel?: string; eventoId?: string }>;
}

export class ServicoEquipamento {
  constructor(private repositorio: RepositorioArquivo) {}

  rastrearEquipamento(id: string): HistoricoCompleto {
    const dadosEquipamento = this.localizarDadosEquipamento(id);

    if (!dadosEquipamento) {
      throw new Error('Equipamento não encontrado.');
    }

    const equipamento = this.reconstituirEquipamento(dadosEquipamento);
    const dadosLote = this.repositorio.carregarEntidade('lotes', equipamento.loteId);

    if (!dadosLote) {
      throw new Error('Lote associado ao equipamento não encontrado.');
    }

    const lote = this.reconstituirLote(dadosLote);
    const dadosOrganizacao = this.repositorio.carregarEntidade('organizacoes', lote.organizacaoId);

    if (!dadosOrganizacao) {
      throw new Error('Organização associada ao lote não encontrada.');
    }

    const organizacao = this.reconstituirOrganizacao(dadosOrganizacao);
    const movimentacoes = [...equipamento.historicoMovimentacao]
      .sort((primeira, segunda) => primeira.dataHora.getTime() - segunda.dataHora.getTime() || primeira.id.localeCompare(segunda.id));
    const linhaDoTempo: HistoricoCompleto['linhaDoTempo'] = [
      { dataHora: organizacao.dataCadastro, tipo: 'ORGANIZACAO', descricao: `Organização ${organizacao.razaoSocial} cadastrada`, eventoId: organizacao.id },
      ...organizacao.contratos.flatMap((contrato) => [
        { dataHora: contrato.dataAssinatura, tipo: 'CONTRATO', descricao: `Contrato ${contrato.id} assinado`, eventoId: contrato.id },
        ...contrato.historicoRenovacoes.map((renovacao) => ({ dataHora: renovacao.registradoEm, tipo: 'RENOVACAO_CONTRATO', descricao: `Contrato ${contrato.id} renovado até ${renovacao.dataVencimentoNovo.toISOString()}`, eventoId: contrato.id })),
        ...(contrato.encerradoEm ? [{ dataHora: contrato.encerradoEm, tipo: 'ENCERRAMENTO_CONTRATO', descricao: `Contrato ${contrato.id} encerrado`, eventoId: contrato.id }] : []),
      ]),
      { dataHora: lote.dataEntrada, tipo: 'LOTE', descricao: `Lote ${lote.id} recebido pela organização ${organizacao.id}`, eventoId: lote.id },
      ...(equipamento.dataCadastro ? [{ dataHora: equipamento.dataCadastro, tipo: 'EQUIPAMENTO', descricao: `Equipamento ${equipamento.id} cadastrado no lote ${lote.id}`, eventoId: equipamento.id }] : []),
      ...movimentacoes.map((evento) => ({
        dataHora: evento.dataHora,
        tipo: evento.tipoEvento,
        descricao: this.descreverEvento(evento),
        responsavel: evento.responsavel,
        eventoId: evento.id,
      })),
    ].sort((primeiro, segundo) => primeiro.dataHora.getTime() - segundo.dataHora.getTime() || (primeiro.eventoId ?? '').localeCompare(segundo.eventoId ?? ''));
    return { equipamento, lote, organizacao, movimentacoes, localizacaoAtual: this.obterLocalAtual(movimentacoes), linhaDoTempo };
  }

  corrigirMovimentacao(identificador: string, movimentacaoId: string, novoDestino: string, responsavel: string, justificativa: string): void {
    const equipamento = this.consultarEquipamento(identificador);
    const original = equipamento.historicoMovimentacao.find((item) => item.id === movimentacaoId);
    if (!original || original.tipoEvento !== 'MOVIMENTACAO') throw new Error('Movimentação original não encontrada.');
    if (equipamento.historicoMovimentacao.some((item) => item.movimentacaoReferenciadaId === movimentacaoId)) throw new Error('Esta movimentação já possui evento de correção ou estorno.');
    if (!novoDestino.trim() || !justificativa.trim()) throw new Error('Informe o novo destino e a justificativa da correção.');
    const localAtual = this.obterLocalAtual(equipamento.historicoMovimentacao);
    equipamento.historicoMovimentacao.push(new Movimentacao(randomUUID(), equipamento.id, new Date(), localAtual, localAtual, responsavel, justificativa.trim(), 'CORRECAO', movimentacaoId, novoDestino.trim()));
    this.repositorio.salvarEntidade('equipamentos', equipamento);
    this.atualizarEquipamentoNoLote(equipamento);
  }

  estornarMovimentacao(identificador: string, movimentacaoId: string, responsavel: string, justificativa: string): void {
    const equipamento = this.consultarEquipamento(identificador);
    const eventos = equipamento.historicoMovimentacao;
    const indiceOriginal = eventos.findIndex((item) => item.id === movimentacaoId && item.tipoEvento === 'MOVIMENTACAO');
    if (indiceOriginal < 0) throw new Error('Movimentação original não encontrada.');
    if (eventos.some((item) => item.movimentacaoReferenciadaId === movimentacaoId)) throw new Error('Esta movimentação já possui evento de correção ou estorno.');
    if (!justificativa.trim()) throw new Error('Informe a justificativa do estorno.');
    const houveMovimentacaoPosterior = eventos.slice(indiceOriginal + 1).some((item) => item.tipoEvento === 'MOVIMENTACAO' || item.tipoEvento === 'ESTORNO');
    if (houveMovimentacaoPosterior) throw new Error('Só é possível estornar a movimentação física mais recente; use correção para registrar ajuste histórico.');
    const original = eventos[indiceOriginal]!;
    equipamento.historicoMovimentacao.push(new Movimentacao(randomUUID(), equipamento.id, new Date(), original.destino, original.origem, responsavel, justificativa.trim(), 'ESTORNO', movimentacaoId));
    this.repositorio.salvarEntidade('equipamentos', equipamento);
    this.atualizarEquipamentoNoLote(equipamento);
  }

  consultarEquipamento(identificador: string): Equipamento {
    return this.reconstituirEquipamento(this.localizarDadosEquipamento(identificador));
  }

  calcularDepreciacao(identificador: string, coeficienteDepreciacao = 0.08): number {
    return this.consultarEquipamento(identificador).calcularDepreciacao(coeficienteDepreciacao);
  }

  listarEquipamentos(filtros: { loteId?: string; status?: StatusRastreamento; incluirCancelados?: boolean } = {}): Equipamento[] {
    return this.repositorio.listarEntidades('equipamentos')
      .map((dados) => this.reconstituirEquipamento(dados))
      .filter((equipamento) => filtros.incluirCancelados || !equipamento.cancelado)
      .filter((equipamento) => !filtros.loteId || equipamento.loteId === filtros.loteId)
      .filter((equipamento) => !filtros.status || equipamento.statusRastreamento === filtros.status);
  }

  atualizarEquipamento(id: string, dados: { marca?: string; modelo?: string; anoFabricacao?: number; pesoQuilogramas?: number }): Equipamento {
    const equipamento = this.consultarEquipamento(id);
    equipamento.exigirAtivo();
    const lote = this.obterLote(equipamento.loteId);
    if (lote.cancelado || lote.statusProcessamento !== StatusLote.RECEBIDO || equipamento.statusRastreamento !== StatusRastreamento.AGUARDANDO_TRIAGEM || equipamento.historicoMovimentacao.length > 0) {
      throw new Error('Só é possível editar dados cadastrais antes da triagem e de qualquer movimentação.');
    }
    if (dados.marca !== undefined) { if (!dados.marca.trim()) throw new Error('A marca é obrigatória.'); equipamento.marca = dados.marca.trim(); }
    if (dados.modelo !== undefined) { if (!dados.modelo.trim()) throw new Error('O modelo é obrigatório.'); equipamento.modelo = dados.modelo.trim(); }
    if (dados.anoFabricacao !== undefined) {
      if (!Number.isInteger(dados.anoFabricacao) || dados.anoFabricacao < 1900 || dados.anoFabricacao > new Date().getFullYear()) throw new Error('O ano de fabricação é inválido.');
      equipamento.anoFabricacao = dados.anoFabricacao;
    }
    if (dados.pesoQuilogramas !== undefined) {
      if (!Number.isFinite(dados.pesoQuilogramas) || dados.pesoQuilogramas <= 0) throw new Error('O peso deve ser maior que zero.');
      equipamento.pesoQuilogramas = dados.pesoQuilogramas;
    }
    this.repositorio.salvarEntidade('equipamentos', equipamento);
    this.atualizarEquipamentoNoLote(equipamento);
    return equipamento;
  }

  atualizarStatusRastreamento(id: string, novoStatus: StatusRastreamento, responsavel: string): void {
    const equipamento = this.consultarEquipamento(id);
    equipamento.exigirAtivo();
    const lote = this.obterLote(equipamento.loteId);
    if (lote.cancelado) throw new Error('O lote está cancelado e não aceita operações nos equipamentos.');
    if (novoStatus === equipamento.statusRastreamento) throw new Error('O equipamento já está neste status.');
    if (equipamento.statusRastreamento === StatusRastreamento.BAIXA_DEFINITIVA) throw new Error('Um equipamento com baixa definitiva não pode mudar de status.');
    const destinosFinais: StatusRastreamento[] = [StatusRastreamento.PECAS_REAPROVEITADAS, StatusRastreamento.MATERIAL_RECICLAVEL, StatusRastreamento.DESCARTE_SEGURO];
    const permitido = equipamento.statusRastreamento === StatusRastreamento.AGUARDANDO_DESMONTE
      ? novoStatus === StatusRastreamento.EM_DESMONTE && lote.statusProcessamento === StatusLote.TRIAGEM_CONCLUIDA
      : equipamento.statusRastreamento === StatusRastreamento.EM_DESMONTE
        ? destinosFinais.includes(novoStatus)
        : destinosFinais.includes(equipamento.statusRastreamento) && novoStatus === StatusRastreamento.BAIXA_DEFINITIVA;
    if (!permitido) throw new Error('Transição de status inválida. Siga a sequência triagem, desmontagem, destinação e baixa definitiva.');
    equipamento.registrarMovimentacao(novoStatus, responsavel, 'STATUS', `Mudança de status: ${equipamento.statusRastreamento} -> ${novoStatus}`, null, null, equipamento.statusRastreamento);
    equipamento.atualizarStatus(novoStatus, 'Alteração de status registrada no histórico.');
    this.repositorio.salvarEntidade('equipamentos', equipamento);
    this.atualizarEquipamentoNoLote(equipamento);
  }

  atualizarEstadoFisico(id: string, novoEstado: EstadoFisico, justificativa = '', responsavel = 'sistema'): void {
    const dados = this.localizarDadosEquipamento(id);

    if (!dados) {
      throw new Error('Equipamento não encontrado.');
    }

    const equipamento = this.reconstituirEquipamento(dados);
    equipamento.exigirAtivo();
    const lote = this.obterLote(equipamento.loteId);
    if (lote.cancelado) throw new Error('O lote está cancelado e não aceita operações nos equipamentos.');
    if (lote.statusProcessamento !== StatusLote.RECEBIDO || equipamento.statusRastreamento !== StatusRastreamento.AGUARDANDO_TRIAGEM) {
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

    if (
      ordem[novoEstado] - ordem[equipamento.estadoFisico] >= 2
      && !justificativa.trim()
    ) {
      throw new Error('Justificativa obrigatória para degradar o estado físico em duas ou mais categorias.');
    }

    const estadoAnterior = equipamento.estadoFisico;
    equipamento.estadoFisico = novoEstado;
    equipamento.historicoMovimentacao.push(new Movimentacao(randomUUID(), equipamento.id, new Date(), estadoAnterior, novoEstado, responsavel, justificativa.trim(), 'ESTADO_FISICO'));
    this.repositorio.salvarEntidade('equipamentos', equipamento);
    this.atualizarEquipamentoNoLote(equipamento);
  }

  registrarMovimentacao(id: string, destino: string, responsavel: string): void {
    const dados = this.localizarDadosEquipamento(id);

    if (!dados) {
      throw new Error('Equipamento não encontrado.');
    }

    const equipamento = this.reconstituirEquipamento(dados);
    equipamento.exigirAtivo();
    this.exigirLoteAtivo(equipamento);
    equipamento.registrarMovimentacao(destino, responsavel, 'MOVIMENTACAO', `Movimentação registrada para ${equipamento.id}`, null, null, this.obterLocalAtual(equipamento.historicoMovimentacao) || 'RECEBIMENTO');
    this.repositorio.salvarEntidade('equipamentos', equipamento);
    this.atualizarEquipamentoNoLote(equipamento);
  }

  cancelarEquipamento(id: string, motivo: string, responsavel = 'sistema'): void {
    const dados = this.localizarDadosEquipamento(id);
    const equipamento = this.reconstituirEquipamento(dados);
    this.exigirLoteAtivo(equipamento);
    equipamento.registrarMovimentacao(equipamento.statusRastreamento, responsavel, 'CANCELAMENTO', `Cadastro cancelado. Motivo: ${motivo.trim()}`, null, null, equipamento.statusRastreamento);
    equipamento.cancelar(motivo);
    this.repositorio.salvarEntidade('equipamentos', equipamento);
    this.atualizarEquipamentoNoLote(equipamento);
  }

  gerarCodigoBarras(tipo: TipoEquipamento, sequencia: number): string {
    if (!Number.isInteger(sequencia) || sequencia <= 0) {
      throw new Error('A sequência do código de barras deve ser um inteiro positivo.');
    }

    let candidato = sequencia;
    let codigo = `GC-${tipo}-${candidato.toString().padStart(6, '0')}`;
    const codigosExistentes = new Set(this.repositorio.listarEntidades('equipamentos').map((item) => item.codigoBarrasInterno));
    while (codigosExistentes.has(codigo)) {
      candidato += 1;
      codigo = `GC-${tipo}-${candidato.toString().padStart(6, '0')}`;
    }
    return codigo;
  }

  private atualizarEquipamentoNoLote(equipamento: Equipamento): void {
    const dadosLote = this.repositorio.carregarEntidade('lotes', equipamento.loteId);

    if (!dadosLote) {
      return;
    }

    const lote = this.reconstituirLote(dadosLote);
    const indice = lote.equipamentos.findIndex((item) => item.id === equipamento.id);

    if (indice !== -1) {
      lote.equipamentos[indice] = equipamento;
      this.repositorio.salvarEntidade('lotes', lote);
    }
  }

  private exigirLoteAtivo(equipamento: Equipamento): void {
    const lote = this.repositorio.carregarEntidade('lotes', equipamento.loteId);
    if (!lote) throw new Error('Lote associado ao equipamento não encontrado.');
    if (lote.cancelado) throw new Error('O lote está cancelado e não aceita operações nos equipamentos.');
  }

  private localizarDadosEquipamento(identificador: string): any {
    const dados = this.repositorio.carregarEntidade('equipamentos', identificador)
      ?? this.repositorio.listarEntidades('equipamentos').find((item) => item.codigoBarrasInterno === identificador);
    if (!dados) throw new Error('Equipamento não encontrado por ID ou código de barras.');
    return dados;
  }

  private obterLote(id: string): Lote {
    const dados = this.repositorio.carregarEntidade('lotes', id);
    if (!dados) throw new Error('Lote associado ao equipamento não encontrado.');
    return this.reconstituirLote(dados);
  }

  private reconstituirEquipamento(dados: any): Equipamento {
    return new Equipamento(
      dados.id,
      dados.codigoBarrasInterno,
      dados.tipo as TipoEquipamento,
      dados.marca,
      dados.modelo,
      dados.anoFabricacao,
      dados.estadoFisico as EstadoFisico,
      dados.pesoQuilogramas,
      dados.loteId,
      dados.posicaoNoLote,
      dados.statusRastreamento as StatusRastreamento,
      (dados.historicoMovimentacao ?? []).map((movimentacao: any) => new Movimentacao(
        movimentacao.id,
        movimentacao.equipamentoId,
        new Date(movimentacao.dataHora),
        movimentacao.origem,
        movimentacao.destino,
        movimentacao.responsavel,
        movimentacao.observacao,
        movimentacao.tipoEvento ?? 'MOVIMENTACAO',
        movimentacao.movimentacaoReferenciadaId ?? null,
        movimentacao.destinoCorrigido ?? null,
      )),
      dados.cancelado ?? false,
      dados.motivoCancelamento ?? null,
      dados.dataCadastro ? new Date(dados.dataCadastro) : null,
    );
  }

  private reconstituirLote(dados: any): Lote {
    return new Lote(
      dados.id,
      new Date(dados.dataEntrada),
      dados.organizacaoId,
      dados.notaFiscal,
      dados.transportadora,
      (dados.equipamentos ?? []).map((equipamento: any) => this.reconstituirEquipamento(equipamento)),
      dados.statusProcessamento as StatusLote,
      dados.observacoes,
      dados.cancelado ?? false,
      dados.motivoCancelamento ?? null,
    );
  }

  private reconstituirOrganizacao(dados: any): Organizacao {
    return new Organizacao(
      dados.id,
      dados.razaoSocial,
      dados.cnpj,
      dados.inscricaoEstadual,
      dados.enderecoCompleto,
      dados.telefone,
      dados.email,
      new Date(dados.dataCadastro),
      dados.ativo,
      this.reconstituirContrato(dados.contratoVigente),
      dados.motivoDesativacao ?? null,
      (dados.contratos ?? (dados.contratoVigente ? [dados.contratoVigente] : [])).map((contrato: any) => this.reconstituirContrato(contrato)!),
    );
  }

  private reconstituirContrato(dados: any): Contrato | null {
    if (!dados) return null;
    return new Contrato(dados.id, dados.organizacaoId, new Date(dados.dataAssinatura), new Date(dados.dataVencimento), dados.clausulas ?? [], dados.valorMensal, dados.renovacaoAutomatica, dados.encerradoEm ? new Date(dados.encerradoEm) : null, (dados.historicoRenovacoes ?? []).map((item: any) => ({ dataVencimentoAnterior: new Date(item.dataVencimentoAnterior), dataVencimentoNovo: new Date(item.dataVencimentoNovo), registradoEm: new Date(item.registradoEm) })));
  }

  private obterLocalAtual(eventos: Movimentacao[]): string {
    const ultimaMovimentacaoFisica = [...eventos]
      .filter((evento) => evento.tipoEvento === 'MOVIMENTACAO' || evento.tipoEvento === 'ESTORNO')
      .sort((primeira, segunda) => primeira.dataHora.getTime() - segunda.dataHora.getTime())
      .at(-1);
    if (!ultimaMovimentacaoFisica) return '';
    return eventos.find((evento) => evento.tipoEvento === 'CORRECAO' && evento.movimentacaoReferenciadaId === ultimaMovimentacaoFisica.id)?.destinoCorrigido ?? ultimaMovimentacaoFisica.destino;
  }

  private descreverEvento(evento: Movimentacao): string {
    if (evento.tipoEvento === 'CORRECAO') return `Correção da movimentação ${evento.movimentacaoReferenciadaId}: destino correto ${evento.destinoCorrigido}. ${evento.observacao}`;
    if (evento.tipoEvento === 'ESTORNO') return `Estorno da movimentação ${evento.movimentacaoReferenciadaId}: ${evento.origem} -> ${evento.destino}. ${evento.observacao}`;
    if (evento.tipoEvento === 'STATUS') return `${evento.observacao} (${evento.origem} -> ${evento.destino})`;
    if (evento.tipoEvento === 'ESTADO_FISICO') return evento.observacao;
    if (evento.tipoEvento === 'CANCELAMENTO') return evento.observacao;
    return `${evento.origem} -> ${evento.destino}. ${evento.observacao}`;
  }
}
