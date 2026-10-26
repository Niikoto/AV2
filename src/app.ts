import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { PrismaClient } from './generated/prisma/client.js';
import { registrarRotasApi } from './routes/api.js';

const descricoesRotas: Record<string, string> = {
  'GET /health': 'Verifica a disponibilidade da API e a conexão com o banco de dados.',
  'POST /auth/login': 'Autentica um usuário e retorna um token de acesso Bearer.',
  'POST /auth/logout': 'Encerra a sessão atual revogando o token de acesso.',
  'POST /auth/credentials': 'Cria uma credencial de acesso; na configuração inicial, permite criar a primeira conta administrativa.',
  'GET /auth/credentials': 'Lista as credenciais de usuários cadastradas.',
  'GET /auth/credentials/search': 'Busca credenciais de usuários pelo nome informado.',
  'GET /auth/credentials/:id': 'Consulta os dados de uma credencial pelo identificador.',
  'PATCH /auth/credentials/:id/name': 'Altera o nome de exibição de uma credencial.',
  'PATCH /auth/credentials/:id/role': 'Altera o papel e as permissões de uma credencial.',
  'PUT /auth/credentials/:id/password': 'Redefine a senha de uma credencial.',
  'DELETE /auth/credentials/:id': 'Desativa uma credencial de acesso.',
  'PUT /auth/password': 'Altera a senha do usuário autenticado.',
  'GET /organizations': 'Lista organizações, com filtros opcionais por nome e situação.',
  'POST /organizations': 'Cadastra uma organização.',
  'GET /organizations/:id': 'Consulta os dados de uma organização.',
  'PATCH /organizations/:id': 'Atualiza os dados informados de uma organização.',
  'DELETE /organizations/:id': 'Desativa uma organização mediante o motivo informado.',
  'GET /organizations/:id/contracts': 'Lista os contratos vinculados a uma organização.',
  'POST /organizations/:id/contracts': 'Cadastra um contrato para uma organização.',
  'PATCH /organizations/:id/contracts/:contratoId': 'Atualiza cláusulas, valor ou renovação automática de um contrato.',
  'POST /organizations/:id/contracts/renew': 'Renova o contrato vigente da organização com a nova data de vencimento.',
  'POST /organizations/:id/contracts/:contratoId/cancel': 'Cancela um contrato específico da organização.',
  'POST /organizations/:id/contracts/close': 'Encerra o contrato vigente da organização.',
  'GET /lots': 'Lista lotes com filtros opcionais por organização, período, situação e cancelamento.',
  'POST /lots': 'Cadastra um lote para uma organização.',
  'POST /lots/with-equipment': 'Cadastra um lote e seus equipamentos em uma única operação.',
  'GET /lots/:id': 'Consulta os dados e os equipamentos associados a um lote.',
  'PATCH /lots/:id': 'Atualiza os dados informados de um lote.',
  'POST /lots/:id/triage': 'Conclui a triagem de um lote.',
  'POST /lots/:id/equipment': 'Adiciona um equipamento a um lote.',
  'DELETE /lots/:id': 'Cancela um lote mediante o motivo informado.',
  'GET /equipment': 'Lista equipamentos com filtros opcionais por lote, nome, situação e cancelamento.',
  'GET /equipment/:id': 'Consulta os dados de um equipamento.',
  'GET /equipment/:id/tracking': 'Consulta o histórico de rastreamento e movimentações de um equipamento.',
  'PATCH /equipment/:id': 'Atualiza os dados de identificação e peso de um equipamento.',
  'PATCH /equipment/:id/status': 'Atualiza a situação de rastreamento de um equipamento.',
  'PATCH /equipment/:id/physical-state': 'Atualiza o estado físico de um equipamento e registra uma justificativa opcional.',
  'POST /equipment/:id/movements': 'Registra uma movimentação do equipamento para o destino informado.',
  'POST /equipment/:id/movements/corrections': 'Corrige uma movimentação existente, informando o destino correto e a justificativa.',
  'POST /equipment/:id/movements/reversals': 'Estorna uma movimentação existente mediante justificativa.',
  'DELETE /equipment/:id': 'Cancela um equipamento mediante o motivo informado.',
  'GET /global-parameters': 'Consulta os parâmetros globais atuais do sistema.',
  'GET /global-parameters/history': 'Lista o histórico de alterações dos parâmetros globais.',
  'PATCH /global-parameters': 'Atualiza os parâmetros globais informados.',
  'GET /reports/status': 'Gera um relatório operacional dos equipamentos na situação informada.',
  'GET /reports/organizations/:id': 'Gera um relatório da organização para o período informado.',
  'GET /reports/financial': 'Gera um relatório financeiro consolidado para o período informado.',
  'GET /reports/audit': 'Gera um relatório de eventos de auditoria para o período informado.',
};

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
      const descricao = descricoesRotas[`${method} ${url}`]
        ?? 'Executa a operação indicada por esta rota da API.';

      return {
        schema: {
          ...routeSchema,
          tags: routeSchema.tags ?? [tag],
          summary: routeSchema.summary ?? descricoesRotas[`${method} ${url}`] ?? `${method} ${url}`,
          description: routeSchema.description ?? descricao,
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
