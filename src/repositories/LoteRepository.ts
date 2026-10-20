import type { Prisma } from '../generated/prisma/client.js';

export class LoteRepository {
  constructor(private prisma: Prisma.TransactionClient) {}

  listar(filtro: Prisma.LoteWhereInput = {}) {
    return this.prisma.lote.findMany({
      where: filtro,
      orderBy: { dataEntrada: 'desc' },
    });
  }

  listarPorOrganizacao(organizacaoId: string) {
    return this.listar({ organizacaoId });
  }

  buscarPorId(id: string) {
    return this.prisma.lote.findUnique({ where: { id } });
  }

  buscarComEquipamentos(id: string) {
    return this.prisma.lote.findUnique({
      where: { id },
      include: { equipamentos: { orderBy: { posicaoNoLote: 'asc' } } },
    });
  }

  criar(dados: Prisma.LoteUncheckedCreateInput) {
    return this.prisma.lote.create({ data: dados });
  }

  atualizar(id: string, dados: Prisma.LoteUncheckedUpdateInput) {
    return this.prisma.lote.update({ where: { id }, data: dados });
  }

  excluir(id: string) {
    return this.prisma.lote.delete({ where: { id } });
  }
}
