import type { Prisma } from '../generated/prisma/client.js';

export class ContratoRepository {
  constructor(private prisma: Prisma.TransactionClient) {}

  listarPorOrganizacao(organizacaoId: string) {
    return this.prisma.contrato.findMany({
      where: { organizacaoId },
      orderBy: { dataAssinatura: 'desc' },
    });
  }

  buscarPorId(id: string) {
    return this.prisma.contrato.findUnique({ where: { id } });
  }

  criar(dados: Prisma.ContratoUncheckedCreateInput) {
    return this.prisma.contrato.create({ data: dados });
  }

  atualizar(id: string, dados: Prisma.ContratoUncheckedUpdateInput) {
    return this.prisma.contrato.update({ where: { id }, data: dados });
  }

  excluir(id: string) {
    return this.prisma.contrato.delete({ where: { id } });
  }
}
