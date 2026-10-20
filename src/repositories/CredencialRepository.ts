import type { Prisma } from '../generated/prisma/client.js';

export class CredencialRepository {
  constructor(private prisma: Prisma.TransactionClient) {}

  listar(ativas?: boolean) {
    return this.prisma.credencial.findMany({
      where: ativas === undefined ? {} : { ativo: ativas },
      orderBy: { usuario: 'asc' },
    });
  }

  buscarPorId(id: string) {
    return this.prisma.credencial.findUnique({ where: { id } });
  }

  buscarPorUsuarioAtivo(usuario: string) {
    return this.prisma.credencial.findFirst({
      where: { usuario, ativo: true },
    });
  }

  criar(dados: Prisma.CredencialCreateInput) {
    return this.prisma.credencial.create({ data: dados });
  }

  atualizar(id: string, dados: Prisma.CredencialUpdateInput) {
    return this.prisma.credencial.update({ where: { id }, data: dados });
  }

  excluir(id: string) {
    return this.prisma.credencial.delete({ where: { id } });
  }
}
