import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from './generated/prisma/client.js';

import { criarAplicacao } from './app.js';

export async function iniciarServidorHttp(
  prisma: PrismaClient,
  port: number,
): Promise<FastifyInstance> {
  const app = criarAplicacao(prisma);

  try {
    await prisma.$connect();
    const address = await app.listen({ host: '127.0.0.1', port });
    app.log.info({ address }, 'Servidor HTTP iniciado.');
    return app;
  } catch (error) {
    app.log.error(
      {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorCode: obterCodigoErro(error),
      },
      'Não foi possível conectar ao banco ou iniciar o servidor HTTP.',
    );
    await app.close();
    throw error;
  }
}

function obterCodigoErro(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}
