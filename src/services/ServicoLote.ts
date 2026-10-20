import { Equipamento } from '../domain/Equipamento.js';
import { Lote } from '../domain/Lote.js';
import { Movimentacao } from '../domain/Movimentacao.js';
import { RepositorioArquivo } from '../infra/RepositorioArquivo.js';
import { EstadoFisico } from '../types/EstadoFisico.js';
import { StatusLote } from '../types/StatusLote.js';
import { StatusRastreamento } from '../types/StatusRastreamento.js';
import { TipoEquipamento } from '../types/TipoEquipamento.js';
import { ValidadorDataEntrada } from '../validators/ValidadorDataEntrada.js';

export class ServicoLote {
  constructor(
    private repositorio: RepositorioArquivo,
    private validadorDataEntrada: ValidadorDataEntrada,
  ) {}

  criarLote(dados: any): Lote {
    const dataEntrada = new Date(dados.dataEntrada);

    if (!this.validadorDataEntrada.validar(dataEntrada)) {
      throw new Error(this.validadorDataEntrada.obterMensagemErro());
    }

    const dadosOrganizacao = this.repositorio.carregarEntidade('organizacoes', dados.organizacaoId);
    if (!dadosOrganizacao) {
      throw new Error('Não é possível criar lote para uma organização inexistente.');
    }
    if (!dadosOrganizacao.ativo) throw new Error('Não é possível criar lote para uma organização desativada.');

    const lote = new Lote(
      dados.id,
      dataEntrada,
      dados.organizacaoId,
      dados.notaFiscal,
      dados.transportadora,
      (dados.equipamentos ?? []).map((equipamento: any) => this.reconstituirEquipamento(equipamento)),
      dados.statusProcessamento ?? StatusLote.RECEBIDO,
      dados.observacoes ?? '',
    );

    this.repositorio.salvarEntidade('lotes', lote);
    return lote;
  }

  adicionarEquipamentoLote(loteId: string, equipamento: Equipamento): void {
    const lote = this.buscarLote(loteId);
    lote.exigirAtivo();
    if (lote.statusProcessamento !== StatusLote.RECEBIDO) throw new Error('Não é possível adicionar equipamento após o início da triagem.');

    if (equipamento.loteId !== loteId) {
      throw new Error('O equipamento deve pertencer ao mesmo lote informado.');
    }

    if (lote.equipamentos.some((item) => item.id === equipamento.id)) {
      throw new Error('O equipamento já pertence a este lote.');
    }
    const equipamentosExistentes = this.repositorio.listarEntidades('equipamentos');
    if (equipamentosExistentes.some((item) => item.id === equipamento.id)) throw new Error('Já existe um equipamento com este identificador.');
    if (equipamentosExistentes.some((item) => item.codigoBarrasInterno === equipamento.codigoBarrasInterno)) throw new Error('Já existe um equipamento com este código de barras.');
    if (!equipamento.marca.trim() || !equipamento.modelo.trim()) throw new Error('Marca e modelo são obrigatórios.');
    if (!Number.isInteger(equipamento.anoFabricacao) || equipamento.anoFabricacao < 1900 || equipamento.anoFabricacao > new Date().getFullYear()) throw new Error('O ano de fabricação é inválido.');
    if (!Number.isFinite(equipamento.pesoQuilogramas) || equipamento.pesoQuilogramas <= 0) throw new Error('O peso deve ser maior que zero.');
    equipamento.exigirAtivo();

    equipamento.posicaoNoLote = lote.equipamentos.length + 1;
    lote.adicionarEquipamento(equipamento);
    this.repositorio.salvarEntidade('equipamentos', equipamento);
    this.repositorio.salvarEntidade('lotes', lote);
  }

  processarTriagem(loteId: string): void {
    const lote = this.buscarLote(loteId);
    lote.exigirAtivo();

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

    lote.statusProcessamento = StatusLote.EM_TRIAGEM;

    for (const equipamento of lote.equipamentos) {
      equipamento.atualizarStatus(StatusRastreamento.AGUARDANDO_DESMONTE, 'Triagem concluída.');
      this.repositorio.salvarEntidade('equipamentos', equipamento);
    }

    lote.statusProcessamento = StatusLote.TRIAGEM_CONCLUIDA;
    this.repositorio.salvarEntidade('lotes', lote);
  }

  consultarLotePorPeriodo(dataInicio: Date, dataFim: Date): Lote[] {
    return this.listarLotes({ dataInicio, dataFim });
  }

  consultarLote(id: string): Lote {
    return this.buscarLote(id);
  }

  listarLotes(filtros: { organizacaoId?: string; dataInicio?: Date; dataFim?: Date; status?: StatusLote; incluirCancelados?: boolean } = {}): Lote[] {
    if (filtros.dataInicio && Number.isNaN(filtros.dataInicio.getTime())) throw new Error('A data inicial do filtro é inválida.');
    if (filtros.dataFim && Number.isNaN(filtros.dataFim.getTime())) throw new Error('A data final do filtro é inválida.');
    if (filtros.dataInicio && filtros.dataFim && filtros.dataInicio > filtros.dataFim) throw new Error('A data inicial não pode ser posterior à data final.');
    return this.repositorio.listarEntidades('lotes')
      .map((dados) => this.reconstituirLote(dados))
      .filter((lote) => filtros.incluirCancelados || !lote.cancelado)
      .filter((lote) => !filtros.organizacaoId || lote.organizacaoId === filtros.organizacaoId)
      .filter((lote) => !filtros.dataInicio || lote.dataEntrada >= filtros.dataInicio)
      .filter((lote) => !filtros.dataFim || lote.dataEntrada <= filtros.dataFim)
      .filter((lote) => !filtros.status || lote.statusProcessamento === filtros.status);
  }

  atualizarLote(id: string, dados: { dataEntrada?: Date; notaFiscal?: string; transportadora?: string; observacoes?: string }): Lote {
    const lote = this.buscarLote(id);
    lote.exigirAtivo();
    if (lote.equipamentos.length > 0 || lote.statusProcessamento !== StatusLote.RECEBIDO) {
      throw new Error('Só é possível editar um lote recebido que ainda não tenha equipamentos vinculados.');
    }
    if (dados.dataEntrada !== undefined) {
      if (!this.validadorDataEntrada.validar(dados.dataEntrada)) throw new Error(this.validadorDataEntrada.obterMensagemErro());
      lote.dataEntrada = dados.dataEntrada;
    }
    if (dados.notaFiscal !== undefined) {
      if (!dados.notaFiscal.trim()) throw new Error('A nota fiscal é obrigatória.');
      lote.notaFiscal = dados.notaFiscal.trim();
    }
    if (dados.transportadora !== undefined) {
      if (!dados.transportadora.trim()) throw new Error('A transportadora é obrigatória.');
      lote.transportadora = dados.transportadora.trim();
    }
    if (dados.observacoes !== undefined) lote.observacoes = dados.observacoes.trim();
    this.repositorio.salvarEntidade('lotes', lote);
    return lote;
  }

  cancelarLote(loteId: string, motivo: string): void {
    const lote = this.buscarLote(loteId);
    if (lote.equipamentos.some((equipamento) => !equipamento.cancelado)) {
      throw new Error('Cancele os equipamentos ainda ativos antes de cancelar o lote.');
    }
    lote.cancelar(motivo);
    this.repositorio.salvarEntidade('lotes', lote);
  }

  private buscarLote(id: string): Lote {
    const dados = this.repositorio.carregarEntidade('lotes', id);

    if (!dados) {
      throw new Error('Lote não encontrado.');
    }

    return this.reconstituirLote(dados);
  }

  private reconstituirLote(dados: any): Lote {
    return new Lote(
      dados.id,
      new Date(dados.dataEntrada),
      dados.organizacaoId,
      dados.notaFiscal,
      dados.transportadora,
      (dados.equipamentos ?? []).map((equipamento: any) => this.reconstituirEquipamento(equipamento)),
      dados.statusProcessamento,
      dados.observacoes,
      dados.cancelado ?? false,
      dados.motivoCancelamento ?? null,
    );
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
}
