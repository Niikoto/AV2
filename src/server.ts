import 'dotenv/config';

import { obterClientePrisma } from './infra/prisma/cliente.js';
import { iniciarServidorHttp } from './serverRuntime.js';

function obterPorta(): number {
  const valor = process.env.PORT ?? '3000';
  const porta = Number(valor);

  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    throw new Error('PORT deve ser um número inteiro entre 1 e 65535.');
  }

  return porta;
}

async function iniciarServidor(): Promise<void> {
  const prisma = obterClientePrisma();
  const app = await iniciarServidorHttp(prisma, obterPorta());

  const encerrar = (signal: NodeJS.Signals): void => {
    app.log.info({ signal }, 'Encerrando servidor HTTP.');
    void app.close().then(
      () => {
        process.exitCode = 0;
      },
      (error: unknown) => {
        app.log.error(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'Falha ao encerrar servidor HTTP.',
        );
        process.exitCode = 1;
      },
    );
  };

  process.once('SIGINT', encerrar);
  process.once('SIGTERM', encerrar);
}

void iniciarServidor().catch((error: unknown) => {
  if (error instanceof Error && error.message.includes('PORT')) {
    console.error(error.message);
  } else if (error instanceof Error && error.message.includes('DATABASE_URL')) {
    console.error(error.message);
  } else {
    console.error('Falha ao iniciar o servidor HTTP.');
  }
  process.exitCode = 1;
});
