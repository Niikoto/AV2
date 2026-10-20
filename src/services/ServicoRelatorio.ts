import { JournalTransacao } from '../infra/JournalTransacao.js';
import { RepositorioArquivo } from '../infra/RepositorioArquivo.js';
import { StatusRastreamento } from '../types/StatusRastreamento.js';

export class ServicoRelatorio {
  constructor(private repositorio: RepositorioArquivo) {}

  gerarRelatorioPorOrganizacao(
    organizacaoId: string,
    periodo: { inicio: Date; fim: Date },
  ): string {
    this.validarPeriodo(periodo);
    const organizacao = this.repositorio.carregarEntidade('organizacoes', organizacaoId);

    if (!organizacao) {
      throw new Error('Organização não encontrada.');
    }

    const lotes = this.repositorio.listarEntidades('lotes').filter((lote) => (
      lote.organizacaoId === organizacaoId
      && this.estaNoPeriodo(new Date(lote.dataEntrada), periodo)
    ));
    const quantidadeEquipamentos = lotes.reduce(
      (total, lote) => total + (lote.equipamentos ?? []).filter((equipamento: any) => !equipamento.cancelado).length,
      0,
    );
    const lotesCancelados = lotes.filter((lote) => lote.cancelado).length;

    return [
      `Relatório por organização: ${organizacao.razaoSocial}`,
      `Período: ${periodo.inicio.toISOString()} até ${periodo.fim.toISOString()}`,
      `Lotes recebidos: ${lotes.length}`,
      `Lotes cancelados: ${lotesCancelados}`,
      `Equipamentos nos lotes: ${quantidadeEquipamentos}`,
    ].join('\n');
  }

  gerarRelatorioPorStatus(status: StatusRastreamento): string {
    const equipamentos = this.repositorio.listarEntidades('equipamentos')
      .filter((equipamento) => !equipamento.cancelado && equipamento.statusRastreamento === status);

    return [
      `Relatório por status: ${status}`,
      `Quantidade de equipamentos: ${equipamentos.length}`,
      ...equipamentos.map((equipamento) => `${equipamento.id} - ${equipamento.codigoBarrasInterno}`),
    ].join('\n');
  }

  gerarRelatorioFinanceiro(periodo: { inicio: Date; fim: Date }): string {
    const organizacoes = this.repositorio.listarEntidades('organizacoes');
    this.validarPeriodo(periodo);
    const contratosNoPeriodo = organizacoes.flatMap((organizacao) => organizacao.contratos ?? (organizacao.contratoVigente ? [organizacao.contratoVigente] : []))
      .filter((contrato) => new Date(contrato.dataAssinatura) <= periodo.fim
        && new Date(contrato.dataVencimento) >= periodo.inicio
        && (!contrato.encerradoEm || new Date(contrato.encerradoEm) >= periodo.inicio));
    const valorMensalContratado = contratosNoPeriodo.reduce(
      (total, contrato) => total + contrato.valorMensal,
      0,
    );
    const transacoesNoPeriodo = JournalTransacao.listar(this.repositorio)
      .filter((transacao) => this.estaNoPeriodo(transacao.timestamp, periodo));

    return [
      'Relatório financeiro',
      `Período: ${periodo.inicio.toISOString()} até ${periodo.fim.toISOString()}`,
      `Contratos vigentes no período: ${contratosNoPeriodo.length}`,
      `Valor mensal contratado: R$ ${valorMensalContratado.toFixed(2)}`,
      `Transações auditadas no período: ${transacoesNoPeriodo.length}`,
    ].join('\n');
  }

  gerarRelatorioAuditoria(periodo: { inicio: Date; fim: Date }): string {
    this.validarPeriodo(periodo);
    const transacoes = JournalTransacao.listar(this.repositorio)
      .filter((transacao) => this.estaNoPeriodo(transacao.timestamp, periodo));
    return [
      'Relatório de auditoria',
      `Período: ${periodo.inicio.toISOString()} até ${periodo.fim.toISOString()}`,
      `Operações: ${transacoes.length}`,
      ...transacoes.map((transacao) => `${transacao.timestamp.toISOString()} | ${transacao.resultado} | ${transacao.operacao} ${transacao.entidade} | responsável: ${transacao.usuarioResponsavel} | transação: ${transacao.transacaoId}`),
    ].join('\n');
  }

  private estaNoPeriodo(data: Date, periodo: { inicio: Date; fim: Date }): boolean {
    return data >= periodo.inicio && data <= periodo.fim;
  }

  private validarPeriodo(periodo: { inicio: Date; fim: Date }): void {
    if (Number.isNaN(periodo.inicio.getTime()) || Number.isNaN(periodo.fim.getTime())) throw new Error('O período do relatório contém data inválida.');
    if (periodo.inicio > periodo.fim) throw new Error('A data inicial não pode ser posterior à data final.');
  }
}
