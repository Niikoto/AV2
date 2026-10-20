import 'dotenv/config';

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import test from 'node:test';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { criarAplicacao } from '../dist/app.js';
import { iniciarServidorHttp } from '../dist/serverRuntime.js';

process.env.JWT_SECRET = 'test-secret-for-greencode-api-validation';

test('health check confirma a conexão real com PostgreSQL', { skip: !process.env.DATABASE_URL }, async () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const app = criarAplicacao(prisma);

  try {
    await prisma.$connect();
    const response = await app.inject({ method: 'GET', url: '/health' });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok', database: 'connected' });
  } finally {
    await app.close();
  }
});

test('health check retorna 503 sem expor detalhes quando o banco falha', async () => {
  const app = criarAplicacao({
    $queryRaw: async () => {
      throw new Error('detalhe interno simulado');
    },
    $disconnect: async () => {},
  });

  const response = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: 'unavailable', database: 'disconnected' });
  assert.equal(response.body.includes('detalhe interno simulado'), false);
  await app.close();
});

test('rotas inexistentes retornam 404 com formato consistente', async () => {
  const app = criarAplicacao({
    $queryRaw: async () => 1,
    $disconnect: async () => {},
  });

  const response = await app.inject({ method: 'GET', url: '/nao-existe' });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: 'NOT_FOUND', message: 'Rota não encontrada.' });
  await app.close();
});

test('documentação OpenAPI descreve rotas, schemas de entrada e autenticação JWT', async () => {
  const app = criarAplicacao({
    $queryRaw: async () => 1,
    $disconnect: async () => {},
  });

  try {
    const openApiResponse = await app.inject({ method: 'GET', url: '/documentation/json' });
    assert.equal(openApiResponse.statusCode, 200);
    const openApi = openApiResponse.json();
    assert.equal(openApi.info.title, 'Greencode API');
    assert.ok(Object.keys(openApi.paths).length >= 30);
    assert.ok(openApi.paths['/auth/login'].post);
    assert.ok(openApi.paths['/organizations'].post.requestBody);
    assert.deepEqual(
      openApi.paths['/organizations'].post.requestBody.content['application/json'].schema.required,
      ['id', 'razaoSocial', 'cnpj', 'inscricaoEstadual', 'enderecoCompleto', 'telefone', 'email'],
    );
    assert.deepEqual(openApi.paths['/auth/login'].post.security, []);
    assert.deepEqual(
      openApi.paths['/equipment/{id}'].get.security,
      [{ bearerAuth: [] }],
    );
    assert.deepEqual(
      openApi.paths['/auth/credentials'].post.security,
      [{}, { bearerAuth: [] }],
    );

    const uiResponse = await app.inject({ method: 'GET', url: '/documentation' });
    assert.equal(uiResponse.statusCode, 200);
    assert.match(uiResponse.headers['content-type'], /text\/html/);
  } finally {
    await app.close();
  }
});

test('rotas de negócio exigem JWT, aplicam permissões e rejeitam corpos inválidos', async () => {
  const credenciais = {
    'admin-api-test': {
      id: 'admin-api-test',
      usuario: 'admin-api-test',
      nomeExibicao: 'Administrador de teste',
      papel: 'ADMINISTRADOR',
      ativo: true,
    },
    'auditor-api-test': {
      id: 'auditor-api-test',
      usuario: 'auditor-api-test',
      nomeExibicao: 'Auditor de teste',
      papel: 'AUDITOR',
      ativo: true,
    },
  };
  let falhaParametro;
  const app = criarAplicacao({
    $queryRaw: async () => 1,
    $disconnect: async () => {},
    credencial: {
      findUnique: async ({ where }) => credenciais[where.id] ?? null,
      findFirst: async () => null,
    },
    parametroGlobal: {
      findFirst: async () => {
        if (falhaParametro) throw falhaParametro;
        return null;
      },
    },
    organizacao: {
      findUnique: async () => null,
    },
  });

  const semAutenticacao = await app.inject({ method: 'GET', url: '/organizations' });
  const corpoInvalido = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { usuario: 'operador' },
  });

  assert.equal(semAutenticacao.statusCode, 401);
  assert.deepEqual(semAutenticacao.json(), {
    error: 'UNAUTHORIZED',
    message: 'Autenticação inválida ou expirada.',
  });
  assert.equal(corpoInvalido.statusCode, 400);
  assert.equal(corpoInvalido.json().error, 'BAD_REQUEST');
  const loginInvalido = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { usuario: 'inexistente', senha: 'senha' },
  });
  assert.equal(loginInvalido.statusCode, 401);

  await app.ready();
  const adminToken = app.jwt.sign({ sub: 'admin-api-test' });
  const consultaPermitida = await app.inject({
    method: 'GET',
    url: '/global-parameters',
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(consultaPermitida.statusCode, 200);
  assert.equal(consultaPermitida.json().id, 'PARAM-DEFAULT');
  const registroInexistente = await app.inject({
    method: 'GET',
    url: '/organizations/ORG-INEXISTENTE',
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(registroInexistente.statusCode, 404);

  falhaParametro = { code: 'P2002', message: 'detalhe interno que não deve vazar' };
  const registroDuplicado = await app.inject({
    method: 'GET',
    url: '/global-parameters',
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(registroDuplicado.statusCode, 409);
  assert.equal(registroDuplicado.json().message, 'Já existe um registro com os dados informados.');
  assert.equal(registroDuplicado.body.includes('detalhe interno que não deve vazar'), false);
  falhaParametro = undefined;

  const auditorToken = app.jwt.sign({ sub: 'auditor-api-test' });
  const acessoNegado = await app.inject({
    method: 'GET',
    url: '/global-parameters',
    headers: { authorization: `Bearer ${auditorToken}` },
  });
  assert.equal(acessoNegado.statusCode, 403);

  const tokenComPapelForjado = app.jwt.sign({
    sub: 'auditor-api-test',
    papel: 'ADMINISTRADOR',
  });
  const papelForjadoNegado = await app.inject({
    method: 'GET',
    url: '/global-parameters',
    headers: { authorization: `Bearer ${tokenComPapelForjado}` },
  });
  assert.equal(papelForjadoNegado.statusCode, 403);

  credenciais['auditor-api-test'].papel = 'ADMINISTRADOR';
  const permissaoAtualizada = await app.inject({
    method: 'GET',
    url: '/global-parameters',
    headers: { authorization: `Bearer ${auditorToken}` },
  });
  assert.equal(permissaoAtualizada.statusCode, 200);

  credenciais['auditor-api-test'].ativo = false;
  const contaDesativada = await app.inject({
    method: 'GET',
    url: '/global-parameters',
    headers: { authorization: `Bearer ${auditorToken}` },
  });
  assert.equal(contaDesativada.statusCode, 401);
  await app.close();
});

test('login HTTP verifica credenciais reais e emite JWT mínimo, expirável e utilizável', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const prefixo = `JWT-HTTP-${randomUUID()}`;
  const usuarioId = `${prefixo}-id`;
  const usuario = `${prefixo}-usuario`;
  const senha = 'senha-http-segura';
  const salt = randomUUID();
  const hashSenha = createHash('sha256').update(`${salt}:${senha}`, 'utf-8').digest('hex');
  let app;

  try {
    await prisma.$connect();
    await prisma.credencial.create({
      data: {
        id: usuarioId,
        usuario,
        nomeExibicao: 'Administrador HTTP',
        hashSenha,
        salt,
        ultimoAcesso: new Date(),
        papel: 'ADMINISTRADOR',
      },
    });
    app = criarAplicacao(prisma, undefined, '30m');

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { usuario, senha },
    });
    assert.equal(login.statusCode, 200);
    const resposta = login.json();
    assert.equal(resposta.tokenType, 'Bearer');
    assert.equal(resposta.expiresIn, '30m');
    assert.equal(resposta.usuario.id, usuarioId);
    assert.equal('hashSenha' in resposta.usuario, false);
    assert.equal('salt' in resposta.usuario, false);

    const payloadJwt = JSON.parse(Buffer.from(resposta.token.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(payloadJwt.sub, usuarioId);
    assert.deepEqual(Object.keys(payloadJwt).sort(), ['exp', 'iat', 'sub']);
    assert.equal(payloadJwt.exp - payloadJwt.iat, 30 * 60);

    const rotaProtegida = await app.inject({
      method: 'GET',
      url: '/auth/credentials',
      headers: { authorization: `Bearer ${resposta.token}` },
    });
    assert.equal(rotaProtegida.statusCode, 200);
    assert.equal(rotaProtegida.json().some((credencial) => credencial.id === usuarioId), true);

    const senhaIncorreta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { usuario, senha: 'senha-incorreta' },
    });
    assert.equal(senhaIncorreta.statusCode, 401);

    const tokenExpirado = app.jwt.sign({ sub: usuarioId }, { expiresIn: '-1s' });
    const acessoExpirado = await app.inject({
      method: 'GET',
      url: '/auth/credentials',
      headers: { authorization: `Bearer ${tokenExpirado}` },
    });
    assert.equal(acessoExpirado.statusCode, 401);

    const tokenInvalido = await app.inject({
      method: 'GET',
      url: '/auth/credentials',
      headers: { authorization: 'Bearer token-invalido' },
    });
    assert.equal(tokenInvalido.statusCode, 401);

    await prisma.credencial.update({
      where: { id: usuarioId },
      data: { ativo: false },
    });
    const contaDesativada = await app.inject({
      method: 'GET',
      url: '/auth/credentials',
      headers: { authorization: `Bearer ${resposta.token}` },
    });
    assert.equal(contaDesativada.statusCode, 401);
  } finally {
    if (app) {
      await prisma.eventoAuditoria.deleteMany({ where: { usuarioResponsavel: usuarioId } });
      await prisma.credencial.deleteMany({ where: { id: usuarioId } });
      await app.close();
    } else {
      await prisma.$disconnect();
    }
  }
});

test('aplicação rejeita segredo e duração JWT inválidos na inicialização', () => {
  const prismaFalso = { $disconnect: async () => {} };
  assert.throws(
    () => criarAplicacao(prismaFalso, 'curto', '30m'),
    /JWT_SECRET/,
  );
  assert.throws(
    () => criarAplicacao(prismaFalso, 'x'.repeat(32), 'nunca'),
    /JWT_EXPIRES_IN/,
  );
});

test('schemas REST rejeitam valores fora dos tipos, enums, formatos e campos permitidos', async () => {
  const app = criarAplicacao({
    $queryRaw: async () => 1,
    $disconnect: async () => {},
  });

  const casos = [
    {
      method: 'POST',
      url: '/auth/login',
      payload: { usuario: ' ', senha: 'senha' },
    },
    {
      method: 'GET',
      url: '/reports/status?status=NAO_EXISTE',
    },
    {
      method: 'GET',
      url: '/reports/financial?inicio=ontem&fim=amanha',
    },
    {
      method: 'POST',
      url: '/lots',
      payload: {
        id: 'LOTE-API',
        dataEntrada: 'data-invalida',
        organizacaoId: 'ORG-API',
        notaFiscal: 'NF',
        transportadora: 'Transportadora',
        campoDesconhecido: true,
      },
    },
    {
      method: 'PATCH',
      url: '/organizations/ORG-API',
      payload: {},
    },
    {
      method: 'POST',
      url: '/organizations',
      payload: {
        id: 'ORG-API',
        razaoSocial: 'Organização de teste',
        cnpj: '00000000000000',
        inscricaoEstadual: '',
        enderecoCompleto: 'Rua de teste',
        telefone: '000000000',
        email: 'email-invalido',
      },
    },
  ];
  for (const caso of casos) {
    const resposta = await app.inject(caso);
    assert.equal(resposta.statusCode, 400, `${caso.method} ${caso.url}`);
    assert.equal(resposta.json().error, 'BAD_REQUEST');
  }
  await app.close();
});

test('rotas HTTP cadastram, consultam, atualizam e desativam organizações sem hard delete', async () => {
  const organizacoes = new Map();
  const eventos = [];
  const administrador = {
    id: 'admin-route-crud',
    usuario: 'admin-route-crud',
    nomeExibicao: 'Administrador de rota',
    papel: 'ADMINISTRADOR',
    ativo: true,
  };
  const prisma = {
    $queryRaw: async () => 1,
    $disconnect: async () => {},
    $transaction: async (callback) => callback(prisma),
    credencial: {
      findUnique: async ({ where }) => where.id === administrador.id ? administrador : null,
    },
    organizacao: {
      findMany: async ({ where }) => [...organizacoes.values()]
        .filter((organizacao) => where.ativo === undefined || organizacao.ativo === where.ativo),
      findUnique: async ({ where }) => {
        if (where.id !== undefined) return organizacoes.get(where.id) ?? null;
        return [...organizacoes.values()].find(
          (organizacao) => organizacao.cnpjNormalizado === where.cnpjNormalizado,
        ) ?? null;
      },
      create: async ({ data }) => {
        const organizacao = {
          ...data,
          dataCadastro: new Date(),
          ativo: true,
          motivoDesativacao: null,
          contratoVigenteId: null,
          version: 0,
        };
        organizacoes.set(organizacao.id, organizacao);
        return organizacao;
      },
      updateMany: async ({ where, data }) => {
        const organizacao = organizacoes.get(where.id);
        if (!organizacao
          || organizacao.version !== where.version
          || (where.ativo !== undefined && organizacao.ativo !== where.ativo)) {
          return { count: 0 };
        }
        const { version, ...campos } = data;
        Object.assign(organizacao, campos);
        if (version?.increment) organizacao.version += version.increment;
        return { count: 1 };
      },
    },
    eventoAuditoria: {
      create: async ({ data }) => {
        eventos.push(data);
        return data;
      },
    },
  };
  const app = criarAplicacao(prisma);
  await app.ready();
  const token = app.jwt.sign({ sub: administrador.id });
  const authorization = { authorization: `Bearer ${token}` };
  const cnpj = '11222333000181';
  const cadastro = await app.inject({
    method: 'POST',
    url: '/organizations',
    headers: authorization,
    payload: {
      id: 'ORG-HTTP-TEST',
      razaoSocial: 'Organização HTTP',
      cnpj,
      inscricaoEstadual: 'ISENTO',
      enderecoCompleto: 'Rua de teste',
      telefone: '11999999999',
      email: 'http-test@example.invalid',
    },
  });
  assert.equal(cadastro.statusCode, 201);
  assert.equal(cadastro.json().id, 'ORG-HTTP-TEST');
  assert.equal('hashSenha' in cadastro.json(), false);

  const duplicado = await app.inject({
    method: 'POST',
    url: '/organizations',
    headers: authorization,
    payload: {
      id: 'ORG-HTTP-DUPLICADA',
      razaoSocial: 'Organização duplicada',
      cnpj,
      inscricaoEstadual: 'ISENTO',
      enderecoCompleto: 'Rua de teste',
      telefone: '11999999999',
      email: 'duplicate@example.invalid',
    },
  });
  assert.equal(duplicado.statusCode, 409);

  const consulta = await app.inject({
    method: 'GET',
    url: '/organizations/ORG-HTTP-TEST',
    headers: authorization,
  });
  assert.equal(consulta.statusCode, 200);
  assert.equal(consulta.json().razaoSocial, 'Organização HTTP');

  const atualizacao = await app.inject({
    method: 'PATCH',
    url: '/organizations/ORG-HTTP-TEST',
    headers: authorization,
    payload: { razaoSocial: 'Organização HTTP atualizada' },
  });
  assert.equal(atualizacao.statusCode, 200);
  assert.equal(atualizacao.json().razaoSocial, 'Organização HTTP atualizada');

  const desativacao = await app.inject({
    method: 'DELETE',
    url: '/organizations/ORG-HTTP-TEST',
    headers: authorization,
    payload: { motivo: 'Encerramento do cadastro de teste' },
  });
  assert.equal(desativacao.statusCode, 204);
  assert.equal(organizacoes.get('ORG-HTTP-TEST').ativo, false);

  const listagemAtiva = await app.inject({
    method: 'GET',
    url: '/organizations',
    headers: authorization,
  });
  assert.deepEqual(listagemAtiva.json(), []);
  assert.equal(eventos.length, 3);
  await app.close();
});

test('erros internos retornam resposta sanitizada', async () => {
  const app = criarAplicacao({
    $queryRaw: async () => 1,
    $disconnect: async () => {},
  });
  app.get('/erro-interno', async () => {
    throw new Error('detalhe confidencial');
  });

  const response = await app.inject({ method: 'GET', url: '/erro-interno' });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), {
    error: 'INTERNAL_SERVER_ERROR',
    message: 'Erro interno do servidor.',
  });
  assert.equal(response.body.includes('detalhe confidencial'), false);
  await app.close();
});

test('fechar a aplicação desconecta Prisma', async () => {
  let disconnectCount = 0;
  const app = criarAplicacao({
    $queryRaw: async () => 1,
    $disconnect: async () => {
      disconnectCount += 1;
    },
  });

  await app.close();

  assert.equal(disconnectCount, 1);
});

test('falha ao conectar Prisma impede o servidor de iniciar e desconecta recursos', async () => {
  let disconnectCount = 0;
  const prisma = {
    $connect: async () => {
      throw new Error('falha simulada');
    },
    $queryRaw: async () => 1,
    $disconnect: async () => {
      disconnectCount += 1;
    },
  };

  await assert.rejects(iniciarServidorHttp(prisma, 0), /falha simulada/);
  assert.equal(disconnectCount, 1);
});

test('falha ao abrir porta desconecta Prisma e libera recursos', async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  let disconnectCount = 0;
  const prisma = {
    $connect: async () => {},
    $queryRaw: async () => 1,
    $disconnect: async () => {
      disconnectCount += 1;
    },
  };

  try {
    await assert.rejects(iniciarServidorHttp(prisma, address.port), /already in use|EADDRINUSE/i);
    assert.equal(disconnectCount, 1);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test('servidor HTTP atende health check com banco e fecha listener e Prisma', { skip: !process.env.DATABASE_URL }, async () => {
  const port = await obterPortaLivre();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  let app;
  try {
    app = await iniciarServidorHttp(prisma, port);
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', database: 'connected' });
  } finally {
    if (app) await app.close();
    else await prisma.$disconnect();
  }
  assert.equal(app.server.listening, false);
});

async function obterPortaLivre() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}
