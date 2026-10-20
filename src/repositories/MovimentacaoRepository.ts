import type { Prisma } from '../generated/prisma/client.js';

export class MovimentacaoRepository {
  constructor(private prisma: Prisma.TransactionClient) {}

  listarPorEquipamento(equipamentoId: string) {
    return this.prisma.movimentacao.findMany({
      where: { equipamentoId },
      orderBy: [{ dataHora: 'asc' }, { id: 'asc' }],
    });
  }

  buscarPorId(id: string) {
    return this.prisma.movimentacao.findUnique({ where: { id } });
  }

  criar(dados: Prisma.MovimentacaoUncheckedCreateInput) {
    return this.prisma.movimentacao.create({ data: dados });
  }

  atualizar(id: string, dados: Prisma.MovimentacaoUncheckedUpdateInput) {
    return this.prisma.movimentacao.update({ where: { id }, data: dados });
  }

  excluir(id: string) {
    return this.prisma.movimentacao.delete({ where: { id } });
  }
}
