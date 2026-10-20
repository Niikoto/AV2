import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { PrismaClient } from './generated/prisma/client.js';
import { registrarRotasApi } from './routes/api.js';

export function criarAplicacao(
  prisma: PrismaClient,
  jwtSecret = process.env.JWT_SECRET,
  jwtExpiresIn = process.env.JWT_EXPIRES_IN ?? '30m',
) {
  if (!jwtSecret || jwtSecret.length < 32 || jwtSecret === 'replace_with_a_random_secret_of_at_least_32_characters') {
    throw new Error('JWT_SECRET deve ser um segredo próprio com pelo menos 32 caracteres.');
  }
  if (!/^[1-9]\d{0,5}[smhd]$/.test(jwtExpiresIn)) {
    throw new Error('JWT_EXPIRES_IN deve ser uma duração positiva em segundos, minutos, horas ou dias (ex.: 30m).');
  }

  const app = Fastify({
    logger: {
      level: 'info',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.senha',
          'req.body.senhaAtual',
          'req.body.senhaNova',
        ],
        censor: '[REDACTED]',
      },
    },
  });

  app.register(fastifyJwt, { secret: jwtSecret });
  app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Greencode API',
        description: 'API REST do sistema de logística reversa. Os papéis e regras de autorização estão descritos no README.',
        version: '1.0.0',
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      tags: [
        { name: 'Health', description: 'Disponibilidade da API e do banco.' },
        { name: 'Authentication', description: 'Login, senha e gestão de credenciais.' },
        { name: 'Organizations', description: 'Organizações e contratos.' },
        { name: 'Operations', description: 'Lotes, equipamentos, status e movimentações.' },
        { name: 'Global parameters', description: 'Parâmetros globais e histórico.' },
        { name: 'Reports', description: 'Relatórios operacionais, financeiros e de auditoria.' },
      ],
    },
    transform: ({ schema, url, route }) => {
      const method = Array.isArray(route.method) ? route.method[0] : route.method;
      const publicRoute = (method === 'GET' && url === '/health')
        || (method === 'POST' && url === '/auth/login');
      const initialCredentialRoute = method === 'POST' && url === '/auth/credentials';
      const tag = url === '/health'
        ? 'Health'
        : url.startsWith('/auth/')
          ? 'Authentication'
          : url.startsWith('/organizations')
            ? 'Organizations'
            : url.startsWith('/lots') || url.startsWith('/equipment')
              ? 'Operations'
              : url.startsWith('/global-parameters')
                ? 'Global parameters'
                : 'Reports';
      const security: NonNullable<typeof schema.security> = publicRoute
        ? []
        : initialCredentialRoute
          ? [{}, { bearerAuth: [] }]
          : [{ bearerAuth: [] }];
      const routeSchema = schema ?? {};

      return {
        schema: {
          ...routeSchema,
          tags: routeSchema.tags ?? [tag],
          summary: routeSchema.summary ?? `${method} ${url}`,
          security,
        },
        url,
      };
    },
  });
  app.register(async (api) => {
    registrarRotasApi(api, prisma, jwtExpiresIn);

    api.get('/health', async (_request, reply) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return { status: 'ok', database: 'connected' };
      } catch (error) {
        api.log.error(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'Health check não conseguiu consultar o banco de dados.',
        );
        return reply.code(503).send({ status: 'unavailable', database: 'disconnected' });
      }
    });
  });
  app.register(fastifySwaggerUi, {
    routePrefix: '/documentation',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({
      error: 'NOT_FOUND',
      message: 'Rota não encontrada.',
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const candidateStatusCode = error instanceof Error && 'statusCode' in error
      ? error.statusCode
      : undefined;
    const statusCode = typeof candidateStatusCode === 'number'
      && candidateStatusCode >= 400
      && candidateStatusCode < 600
      ? candidateStatusCode
      : 500;

    if (statusCode >= 500) {
      request.log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError', statusCode },
        'Falha ao processar requisição.',
      );
    } else {
      request.log.warn(
        { errorName: error instanceof Error ? error.name : 'UnknownError', statusCode },
        'Requisição inválida.',
      );
    }

    const codeByStatus: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
    };
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : codeByStatus[statusCode] ?? 'BAD_REQUEST',
      message: statusCode >= 500
        ? 'Erro interno do servidor.'
        : error instanceof Error ? error.message : 'Requisição inválida.',
    });
  });

  return app;
}
