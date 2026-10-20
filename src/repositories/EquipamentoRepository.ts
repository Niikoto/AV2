import type { Prisma } from '../generated/prisma/client.js';

export class EquipamentoRepository {
  constructor(private prisma: Prisma.TransactionClient) {}

  listar(filtro: Prisma.EquipamentoWhereInput = {}) {
    return this.prisma.equipamento.findMany({
      where: filtro,
      orderBy: [{ loteId: 'asc' }, { posicaoNoLote: 'asc' }],
    });
  }

  listarPorLote(loteId: string) {
    return this.listar({ loteId });
  }

  buscarPorId(id: string) {
    return this.prisma.equipamento.findUnique({ where: { id } });
  }

  buscarPorCodigoBarras(codigoBarrasInterno: string) {
    return this.prisma.equipamento.findUnique({ where: { codigoBarrasInterno } });
  }

  buscarComMovimentacoes(id: string) {
    return this.prisma.equipamento.findUnique({
      where: { id },
      include: { movimentacoes: { orderBy: { dataHora: 'asc' } } },
    });
  }

  criar(dados: Prisma.EquipamentoUncheckedCreateInput) {
    return this.prisma.equipamento.create({ data: dados });
  }

  atualizar(id: string, dados: Prisma.EquipamentoUncheckedUpdateInput) {
    return this.prisma.equipamento.update({ where: { id }, data: dados });
  }

  excluir(id: string) {
    return this.prisma.equipamento.delete({ where: { id } });
  }
}
