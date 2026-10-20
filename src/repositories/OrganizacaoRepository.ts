import type { Prisma } from '../generated/prisma/client.js';

export class OrganizacaoRepository {
  constructor(private prisma: Prisma.TransactionClient) {}

  listar(filtro: Prisma.OrganizacaoWhereInput = {}) {
    return this.prisma.organizacao.findMany({
      where: filtro,
      orderBy: { razaoSocial: 'asc' },
    });
  }

  buscarPorId(id: string) {
    return this.prisma.organizacao.findUnique({ where: { id } });
  }

  buscarPorCnpj(cnpj: string) {
    return this.prisma.organizacao.findUnique({ where: { cnpj } });
  }

  buscarPorCnpjNormalizado(cnpjNormalizado: string) {
    return this.prisma.organizacao.findUnique({ where: { cnpjNormalizado } });
  }

  criar(dados: Prisma.OrganizacaoUncheckedCreateInput) {
    return this.prisma.organizacao.create({ data: dados });
  }

  atualizar(id: string, dados: Prisma.OrganizacaoUncheckedUpdateInput) {
    return this.prisma.organizacao.update({ where: { id }, data: dados });
  }

  excluir(id: string) {
    return this.prisma.organizacao.delete({ where: { id } });
  }
}
