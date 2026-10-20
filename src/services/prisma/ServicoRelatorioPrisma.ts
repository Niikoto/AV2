import type { PrismaClient } from '../../generated/prisma/client.js';
import { StatusRastreamento } from '../../generated/prisma/enums.js';
import { ServicoAuditoriaPrisma } from './ServicoAuditoriaPrisma.js';

export class ServicoRelatorioPrisma {
  constructor(private prisma: PrismaClient) {}

  async gerarRelatorioPorOrganizacao(
    organizacaoId: string,
    periodo: { inicio: Date; fim: Date },
  ): Promise<string> {
    this.validarPeriodo(periodo);
    const organizacao = await this.prisma.organizacao.findUnique({
      where: { id: organizacaoId },
      include: {
        lotes: {
          where: { dataEntrada: { gte: periodo.inicio, lte: periodo.fim } },
        },
      },
    });
    if (!organizacao) throw new Error('Organização não encontrada.');

    const lotesCancelados = organizacao.lotes.filter((lote) => lote.cancelado).length;
    const lotesNoPeriodo = organizacao.lotes.map((lote) => lote.id);
    const equipamentos = lotesNoPeriodo.length
      ? await this.prisma.equipamento.count({
        where: { loteId: { in: lotesNoPeriodo }, cancelado: false },
      })
      : 0;

    return [
      `Relatório por organização: ${organizacao.razaoSocial}`,
      `Período: ${periodo.inicio.toISOString()} até ${periodo.fim.toISOString()}`,
      `Lotes recebidos: ${organizacao.lotes.length}`,
      `Lotes cancelados: ${lotesCancelados}`,
      `Equipamentos nos lotes: ${equipamentos}`,
    ].join('\n');
  }

  async gerarRelatorioPorStatus(status: StatusRastreamento): Promise<string> {
    const equipamentos = await this.prisma.equipamento.findMany({
      where: { cancelado: false, statusRastreamento: status },
      orderBy: { id: 'asc' },
      select: { id: true, codigoBarrasInterno: true },
    });
    return [
      `Relatório por status: ${status}`,
      `Quantidade de equipamentos: ${equipamentos.length}`,
      ...equipamentos.map((equipamento) => `${equipamento.id} - ${equipamento.codigoBarrasInterno}`),
    ].join('\n');
  }

  async gerarRelatorioFinanceiro(periodo: { inicio: Date; fim: Date }): Promise<string> {
    this.validarPeriodo(periodo);
    const [contratos, eventosAuditoria] = await Promise.all([
      this.prisma.contrato.findMany({
        where: {
          dataAssinatura: { lte: periodo.fim },
          dataVencimento: { gte: periodo.inicio },
          OR: [{ encerradoEm: null }, { encerradoEm: { gte: periodo.inicio } }],
        },
        select: { valorMensal: true },
      }),
      new ServicoAuditoriaPrisma(this.prisma).listar(periodo),
    ]);
    const valorMensalContratado = contratos.reduce((total, contrato) => total + contrato.valorMensal, 0);
    return [
      'Relatório financeiro',
      `Período: ${periodo.inicio.toISOString()} até ${periodo.fim.toISOString()}`,
      `Contratos vigentes no período: ${contratos.length}`,
      `Valor mensal contratado: R$ ${valorMensalContratado.toFixed(2)}`,
      `Transações auditadas no período: ${eventosAuditoria.length}`,
    ].join('\n');
  }

  async gerarRelatorioAuditoria(periodo: { inicio: Date; fim: Date }): Promise<string> {
    this.validarPeriodo(periodo);
    const eventos = await new ServicoAuditoriaPrisma(this.prisma).listar(periodo);
    return [
      'Relatório de auditoria',
      `Período: ${periodo.inicio.toISOString()} até ${periodo.fim.toISOString()}`,
      `Operações: ${eventos.length}`,
      ...eventos.map((evento) => (
        `${evento.timestamp.toISOString()} | ${evento.resultado} | ${evento.operacao} ${evento.entidade} | responsável: ${evento.usuarioResponsavel} | transação: ${evento.transacaoId}`
      )),
    ].join('\n');
  }

  private validarPeriodo(periodo: { inicio: Date; fim: Date }): void {
    if (Number.isNaN(periodo.inicio.getTime()) || Number.isNaN(periodo.fim.getTime())) {
      throw new Error('O período do relatório contém data inválida.');
    }
    if (periodo.inicio > periodo.fim) {
      throw new Error('A data inicial não pode ser posterior à data final.');
    }
  }
}
