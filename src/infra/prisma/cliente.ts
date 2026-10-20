import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';

let cliente: PrismaClient | undefined;

export function obterClientePrisma(): PrismaClient {
  if (!cliente) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('A variável DATABASE_URL é obrigatória para conectar ao PostgreSQL.');
    }

    cliente = new PrismaClient({
      adapter: new PrismaPg({ connectionString }),
    });
  }

  return cliente;
}

export async function desconectarClientePrisma(): Promise<void> {
  if (!cliente) return;

  await cliente.$disconnect();
  cliente = undefined;
}
