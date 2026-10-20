import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { EventoAuditoriaRepository } from '../../repositories/EventoAuditoriaRepository.js';

export type DadosEventoAuditoria = {
  operacao: string;
  entidade: string;
  dadosAntes?: Prisma.InputJsonValue | null;
  dadosDepois?: Prisma.InputJsonValue | null;
  usuarioResponsavel: string;
  identificadorAnterior?: string;
};

export type EventoAuditoriaPublicado = {
  id: string;
  timestamp: Date;
  operacao: string;
  entidade: string;
  dadosAntes: Prisma.JsonValue | null;
  dadosDepois: Prisma.JsonValue | null;
  usuarioResponsavel: string;
  transacaoId: string;
  fase: string;
  resultado: 'CONFIRMADA' | 'ABORTADA' | 'PENDENTE';
  identificadorAnterior: string | null;
};

export class ServicoAuditoriaPrisma {
  constructor(private prisma: PrismaClient) {}

  static async registrarNaTransacao(
    tx: Prisma.TransactionClient,
    evento: DadosEventoAuditoria,
  ): Promise<void> {
    if (!evento.operacao.trim() || !evento.entidade.trim() || !evento.usuarioResponsavel.trim()) {
      throw new Error('Operação, entidade e responsável são obrigatórios para auditoria.');
    }
    await new EventoAuditoriaRepository(tx).criar({
      id: `audit-${randomUUID()}`,
      operacao: evento.operacao.trim(),
      entidade: evento.entidade.trim(),
      dadosAntes: evento.dadosAntes ?? undefined,
      dadosDepois: evento.dadosDepois ?? undefined,
      usuarioResponsavel: evento.usuarioResponsavel.trim(),
      transacaoId: randomUUID(),
      fase: 'REGISTRO',
      identificadorAnterior: evento.identificadorAnterior,
    });
  }

  async executar<T>(
    evento: DadosEventoAuditoria,
    operacao: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const resultado = await operacao(tx);
      await ServicoAuditoriaPrisma.registrarNaTransacao(tx, evento);
      return resultado;
    });
  }

  async listar(periodo?: { inicio: Date; fim: Date }): Promise<EventoAuditoriaPublicado[]> {
    if (periodo) this.validarPeriodo(periodo);
    const repository = new EventoAuditoriaRepository(this.prisma);
    const eventos = await repository.listar(
      periodo ? { timestamp: { gte: periodo.inicio, lte: periodo.fim } } : {},
    );
    const desfechos = new Map<string, string>();
    const transacoesComIntencao = eventos
      .filter((evento) => evento.fase === 'INTENCAO')
      .map((evento) => evento.transacaoId);
    const desfechosPersistidos = transacoesComIntencao.length
      ? await repository.listar({
        transacaoId: { in: transacoesComIntencao },
        fase: { in: ['CONFIRMACAO', 'ABORTO'] },
      })
      : eventos;
    for (const evento of desfechosPersistidos) {
      if (evento.fase === 'CONFIRMACAO' || evento.fase === 'ABORTO') {
        desfechos.set(evento.transacaoId, evento.fase);
      }
    }

    return eventos
      .filter((evento) => evento.fase === 'REGISTRO' || evento.fase === 'INTENCAO')
      .map((evento) => ({
        ...evento,
        resultado: evento.fase === 'REGISTRO'
          ? 'CONFIRMADA'
          : desfechos.get(evento.transacaoId) === 'CONFIRMACAO'
            ? 'CONFIRMADA'
            : desfechos.get(evento.transacaoId) === 'ABORTO'
              ? 'ABORTADA'
              : 'PENDENTE',
      }));
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
