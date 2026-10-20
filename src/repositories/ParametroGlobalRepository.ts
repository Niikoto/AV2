import type { Prisma } from '../generated/prisma/client.js';

export class ParametroGlobalRepository {
  constructor(private prisma: Prisma.TransactionClient) {}

  buscarAtual() {
    return this.prisma.parametroGlobal.findFirst({
      orderBy: { versao: 'desc' },
    });
  }

  listarHistorico() {
    return this.prisma.parametroGlobal.findMany({
      orderBy: { versao: 'asc' },
    });
  }

  criar(dados: Prisma.ParametroGlobalCreateInput) {
    return this.prisma.parametroGlobal.create({ data: dados });
  }
}
