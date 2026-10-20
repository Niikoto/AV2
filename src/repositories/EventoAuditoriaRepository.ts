import type { Prisma } from '../generated/prisma/client.js';

export class EventoAuditoriaRepository {
  constructor(private prisma: Prisma.TransactionClient) {}

  criar(dados: Prisma.EventoAuditoriaCreateInput) {
    return this.prisma.eventoAuditoria.create({ data: dados });
  }

  listar(filtro: Prisma.EventoAuditoriaWhereInput = {}) {
    return this.prisma.eventoAuditoria.findMany({
      where: filtro,
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
    });
  }
}
