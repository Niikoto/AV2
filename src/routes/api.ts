import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  EstadoFisico,
  PapelUsuario,
  StatusLote,
  StatusRastreamento,
  TipoEquipamento,
} from '../generated/prisma/enums.js';
import { ServicoAutenticacaoPrisma } from '../services/prisma/ServicoAutenticacaoPrisma.js';
import { ServicoEquipamentoPrisma } from '../services/prisma/ServicoEquipamentoPrisma.js';
import { ServicoLotePrisma } from '../services/prisma/ServicoLotePrisma.js';
import { ServicoOrganizacaoPrisma } from '../services/prisma/ServicoOrganizacaoPrisma.js';
import { ServicoParametrosGlobaisPrisma } from '../services/prisma/ServicoParametrosGlobaisPrisma.js';
import { ServicoRelatorioPrisma } from '../services/prisma/ServicoRelatorioPrisma.js';

declare module 'fastify' {
  interface FastifyRequest {
    apiUsuario?: { id: string; papel: PapelUsuario; usuario: string };
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

type IdentificadorParams = { id: string };
type ContratoParams = { id: string; contratoId: string };
type OrganizacaoBody = {
  id: string;
  razaoSocial: string;
  cnpj: string;
  inscricaoEstadual: string;
  enderecoCompleto: string;
  telefone: string;
  email: string;
};
type EquipamentoBody = {
  id: string;
  codigoBarrasInterno: string;
  tipo: TipoEquipamento;
  marca: string;
  modelo: string;
  anoFabricacao: number;
  estadoFisico: EstadoFisico;
  pesoQuilogramas: number;
};
type LoteBody = {
  id: string;
  dataEntrada: string;
  organizacaoId: string;
  notaFiscal: string;
  transportadora: string;
  observacoes?: string;
};
type PeriodoQuery = { inicio: string; fim: string };
type CampoExtra = {
  type: string;
  enum?: string[];
  items?: CampoExtra;
  properties?: Record<string, CampoExtra>;
  required?: string[];
  additionalProperties?: boolean;
  minLength?: number;
  minProperties?: number;
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minItems?: number;
};

const schemaId = { type: 'string', minLength: 1, pattern: '\\S' } as const;
const schemaString = { type: 'string' } as const;
const schemaNaoVazio = { type: 'string', minLength: 1, pattern: '\\S' } as const;
const schemaEmail = {
  type: 'string',
  minLength: 3,
  pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
};
const schemaData = { type: 'string', format: 'date-time' } as const;
const schemaBody = (
  required: string[],
  properties: Record<string, CampoExtra>,
) => ({
  body: {
    type: 'object',
    required,
    ...(required.length === 0 ? { minProperties: 1 } : {}),
    additionalProperties: false,
    properties,
  },
});
const schemaParamsId = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: schemaId },
  },
};
const schemaEnum = (valores: object) => ({
  type: 'string',
  enum: Object.values(valores),
});
const schemaEquipamento = {
  id: schemaNaoVazio,
  codigoBarrasInterno: schemaNaoVazio,
  tipo: schemaEnum(TipoEquipamento),
  marca: schemaNaoVazio,
  modelo: schemaNaoVazio,
  anoFabricacao: { type: 'integer', minimum: 1900, maximum: new Date().getFullYear() },
  estadoFisico: schemaEnum(EstadoFisico),
  pesoQuilogramas: { type: 'number', exclusiveMinimum: 0 },
};
const admin = [PapelUsuario.ADMINISTRADOR];
const cadastro = [PapelUsuario.ADMINISTRADOR, PapelUsuario.OPERADOR_CADASTRO];
const almoxarifado = [PapelUsuario.ADMINISTRADOR, PapelUsuario.GESTOR_ALMOXARIFADO];
const leituraOrganizacao = [...cadastro, PapelUsuario.AUDITOR];
const leituraOperacional = [...almoxarifado, PapelUsuario.AUDITOR];
const auditoria = [PapelUsuario.ADMINISTRADOR, PapelUsuario.AUDITOR];

class ErroApi extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export function registrarRotasApi(
  app: FastifyInstance,
  prisma: PrismaClient,
  jwtExpiresIn: string,
): void {
  const autenticacao = new ServicoAutenticacaoPrisma(prisma);
  const organizacoes = new ServicoOrganizacaoPrisma(prisma);
  const lotes = new ServicoLotePrisma(prisma);
  const equipamentos = new ServicoEquipamentoPrisma(prisma);
  const parametros = new ServicoParametrosGlobaisPrisma(prisma);
  const relatorios = new ServicoRelatorioPrisma(prisma);

  const autenticar = async (request: FastifyRequest): Promise<void> => {
    try {
      await request.jwtVerify();
    } catch {
      throw new ErroApi(401, 'Autenticação inválida ou expirada.');
    }
    if (typeof request.user.sub !== 'string' || !request.user.sub.trim()) {
      throw new ErroApi(401, 'Autenticação inválida ou expirada.');
    }
    let usuario;
    try {
      usuario = await autenticacao.buscarCredencialAtiva(request.user.sub);
    } catch (error) {
      if (error instanceof Error && error.message === 'Usuário ativo não encontrado.') {
        throw new ErroApi(401, 'Autenticação inválida ou expirada.');
      }
      throw error;
    }
    request.apiUsuario = { id: usuario.id, papel: usuario.papel, usuario: usuario.usuario };
  };
  const autenticarPreHandler: preHandlerHookHandler = async (request) => autenticar(request);
  const exigirPapel = (permitidos: PapelUsuario[]): preHandlerHookHandler => async (request) => {
    const usuario = request.apiUsuario;
    if (!usuario) throw new ErroApi(401, 'Autenticação necessária.');
    if (!permitidos.includes(usuario.papel)) throw new ErroApi(403, 'Usuário sem permissão para esta operação.');
  };
  const comPermissao = (permitidos: PapelUsuario[]) => [autenticarPreHandler, exigirPapel(permitidos)];
  const responsavel = (request: FastifyRequest): string => {
    if (!request.apiUsuario) throw new ErroApi(401, 'Autenticação necessária.');
    return request.apiUsuario.id;
  };
  const usuarioOpcional = async (request: FastifyRequest): Promise<string | undefined> => {
    if (!request.headers.authorization) return undefined;
    await autenticar(request);
    return responsavel(request);
  };
  const executar = async <T>(operacao: () => Promise<T>): Promise<T> => {
    try {
      return await operacao();
    } catch (error) {
      if (error instanceof ErroApi) throw error;
      if (typeof error === 'object' && error !== null && 'code' in error) {
        const code = error.code;
        if (code === 'P2002') throw new ErroApi(409, 'Já existe um registro com os dados informados.');
        if (code === 'P2003') {
          throw new ErroApi(409, 'A operação conflita com um relacionamento existente.');
        }
        if (code === 'P2025') throw new ErroApi(404, 'O registro solicitado não foi encontrado.');
        if (code === 'P2034') {
          throw new ErroApi(409, 'Conflito de atualização. Recarregue os dados e tente novamente.');
        }
        if (code === 'P2000' || code === 'P2011' || code === 'P2012' || code === 'P2023') {
          throw new ErroApi(400, 'Os dados informados não são válidos para esta operação.');
        }
        if (typeof code === 'string' && code.startsWith('P')) throw error;
      }
      const message = error instanceof Error ? error.message : 'Não foi possível processar a operação.';
      const status = /não encontrad[oa]|inexistente/i.test(message)
        ? 404
        : /conflito|já existe|já possui|duplicad/i.test(message)
          ? 409
          : /usuário ou senha inválidos/i.test(message)
            ? 401
            : /não autenticado|permissão|sem permissão|somente para consulta/i.test(message)
              ? 403
              : /obrigat|inválid|informe|deve |não é possível|só é possível|não é permitido|não permite|não aceita|não pode|já está|transição|triagem|peso|taxa|alíquota|usuário ativo|sessão administrativa|primeira conta|último administrador|não possui/i.test(message)
                ? 400
                : undefined;
      if (status === undefined) throw error;
      throw new ErroApi(status, message);
    }
  };
  const data = (value: string): Date => new Date(value);
  const periodo = (query: PeriodoQuery) => ({ inicio: data(query.inicio), fim: data(query.fim) });

  app.post<{ Body: { usuario: string; senha: string } }>('/auth/login', {
    schema: schemaBody(['usuario', 'senha'], { usuario: schemaNaoVazio, senha: schemaNaoVazio }),
  }, async (request, reply) => {
    const credencial = await executar(() => autenticacao.autenticar(request.body.usuario, request.body.senha));
    const token = app.jwt.sign({ sub: credencial.id }, {
      expiresIn: jwtExpiresIn,
    });
    return reply.send({ token, tokenType: 'Bearer', expiresIn: jwtExpiresIn, usuario: credencial });
  });

  app.post<{ Body: { usuario: string; senha: string; papel: PapelUsuario; nomeExibicao?: string } }>(
    '/auth/credentials',
    {
      schema: schemaBody(['usuario', 'senha', 'papel'], {
        usuario: schemaNaoVazio,
        senha: schemaNaoVazio,
        papel: schemaEnum(PapelUsuario),
        nomeExibicao: schemaNaoVazio,
      }),
    },
    async (request, reply) => {
      const administradorId = await usuarioOpcional(request);
      const credencial = await executar(() => autenticacao.criarCredencial(
        request.body.usuario,
        request.body.senha,
        request.body.papel,
        request.body.nomeExibicao,
        administradorId,
      ));
      return reply.code(201).send(credencial);
    },
  );

  app.get('/auth/credentials', { preHandler: comPermissao(admin) }, async (request) => (
    executar(() => autenticacao.listarCredenciais(responsavel(request)))
  ));

  app.get<{ Params: IdentificadorParams }>('/auth/credentials/:id', {
    schema: schemaParamsId,
    preHandler: comPermissao(admin),
  }, async (request) => executar(() => autenticacao.buscarCredencial(request.params.id, responsavel(request))));

  app.patch<{ Params: IdentificadorParams; Body: { nomeExibicao: string } }>('/auth/credentials/:id/name', {
    schema: { ...schemaParamsId, ...schemaBody(['nomeExibicao'], { nomeExibicao: schemaNaoVazio }) },
    preHandler: comPermissao(admin),
  }, async (request, reply) => {
    await executar(() => autenticacao.alterarNomeExibicao(
      request.params.id,
      request.body.nomeExibicao,
      responsavel(request),
    ));
    return reply.code(204).send();
  });

  app.patch<{ Params: IdentificadorParams; Body: { papel: PapelUsuario } }>('/auth/credentials/:id/role', {
    schema: { ...schemaParamsId, ...schemaBody(['papel'], { papel: schemaEnum(PapelUsuario) }) },
    preHandler: comPermissao(admin),
  }, async (request, reply) => {
    await executar(() => autenticacao.alterarPapel(request.params.id, request.body.papel, responsavel(request)));
    return reply.code(204).send();
  });

  app.put<{ Params: IdentificadorParams; Body: { senha: string } }>('/auth/credentials/:id/password', {
    schema: { ...schemaParamsId, ...schemaBody(['senha'], { senha: schemaNaoVazio }) },
    preHandler: comPermissao(admin),
  }, async (request, reply) => {
    await executar(() => autenticacao.redefinirSenha(request.params.id, request.body.senha, responsavel(request)));
    return reply.code(204).send();
  });

  app.delete<{ Params: IdentificadorParams }>('/auth/credentials/:id', {
    schema: schemaParamsId,
    preHandler: comPermissao(admin),
  }, async (request, reply) => {
    await executar(() => autenticacao.desativarCredencial(request.params.id, responsavel(request)));
    return reply.code(204).send();
  });

  app.put<{ Body: { senhaAtual: string; senhaNova: string } }>('/auth/password', {
    schema: schemaBody(['senhaAtual', 'senhaNova'], {
      senhaAtual: schemaNaoVazio,
      senhaNova: schemaNaoVazio,
    }),
    preHandler: autenticar,
  }, async (request, reply) => {
    const alterada = await executar(() => autenticacao.alterarSenha(
      responsavel(request),
      request.body.senhaAtual,
      request.body.senhaNova,
    ));
    if (!alterada) throw new ErroApi(400, 'Senha atual inválida ou nova senha vazia.');
    return reply.code(204).send();
  });

  app.get<{ Querystring: { incluirDesativadas?: boolean } }>('/organizations', {
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: { incluirDesativadas: { type: 'boolean' } },
      },
    },
    preHandler: comPermissao(leituraOrganizacao),
  }, async (request) => {
    const incluirDesativadas = request.query.incluirDesativadas ?? false;
    return executar(() => organizacoes.listarOrganizacoes(incluirDesativadas));
  });

  app.post<{ Body: OrganizacaoBody }>('/organizations', {
    schema: schemaBody(
      ['id', 'razaoSocial', 'cnpj', 'inscricaoEstadual', 'enderecoCompleto', 'telefone', 'email'],
      {
        id: schemaNaoVazio,
        razaoSocial: schemaNaoVazio,
        cnpj: schemaNaoVazio,
        inscricaoEstadual: schemaString,
        enderecoCompleto: schemaNaoVazio,
        telefone: schemaNaoVazio,
        email: schemaEmail,
      },
    ),
    preHandler: comPermissao(cadastro),
  }, async (request, reply) => {
    const resultado = await executar(() => organizacoes.cadastrarOrganizacao(request.body, responsavel(request)));
    return reply.code(201).send(resultado);
  });

  app.get<{ Params: IdentificadorParams }>('/organizations/:id', {
    schema: schemaParamsId,
    preHandler: comPermissao(leituraOrganizacao),
  }, async (request) => executar(() => organizacoes.buscarOrganizacao(request.params.id)));

  app.patch<{ Params: IdentificadorParams; Body: Partial<Omit<OrganizacaoBody, 'id'>> }>('/organizations/:id', {
    schema: {
      ...schemaParamsId,
      ...schemaBody([], {
        razaoSocial: schemaNaoVazio,
        cnpj: schemaNaoVazio,
        inscricaoEstadual: schemaString,
        enderecoCompleto: schemaNaoVazio,
        telefone: schemaNaoVazio,
        email: schemaEmail,
      }),
    },
    preHandler: comPermissao(cadastro),
  }, async (request) => executar(() => organizacoes.atualizarOrganizacao(
    request.params.id,
    request.body,
    responsavel(request),
  )));

  app.delete<{ Params: IdentificadorParams; Body: { motivo: string } }>('/organizations/:id', {
    schema: { ...schemaParamsId, ...schemaBody(['motivo'], { motivo: schemaNaoVazio }) },
    preHandler: comPermissao(cadastro),
  }, async (request, reply) => {
    await executar(() => organizacoes.desativarOrganizacao(
      request.params.id,
      request.body.motivo,
      responsavel(request),
    ));
    return reply.code(204).send();
  });

  app.get<{ Params: IdentificadorParams }>('/organizations/:id/contracts', {
    schema: schemaParamsId,
    preHandler: comPermissao(leituraOrganizacao),
  }, async (request) => executar(() => organizacoes.listarContratos(request.params.id)));

  app.post<{ Params: IdentificadorParams; Body: {
    id: string; dataAssinatura: string; dataVencimento: string; clausulas?: string[];
    valorMensal: number; renovacaoAutomatica?: boolean;
  } }>('/organizations/:id/contracts', {
    schema: {
      ...schemaParamsId,
      ...schemaBody(['id', 'dataAssinatura', 'dataVencimento', 'valorMensal'], {
        id: schemaNaoVazio,
        dataAssinatura: schemaData,
        dataVencimento: schemaData,
        clausulas: { type: 'array', items: { type: 'string' } },
        valorMensal: { type: 'number', minimum: 0 },
        renovacaoAutomatica: { type: 'boolean' },
      }),
    },
    preHandler: comPermissao(cadastro),
  }, async (request, reply) => {
    const resultado = await executar(() => organizacoes.cadastrarContrato(
      request.params.id,
      { ...request.body, dataAssinatura: data(request.body.dataAssinatura), dataVencimento: data(request.body.dataVencimento) },
      responsavel(request),
    ));
    return reply.code(201).send(resultado);
  });

  app.patch<{ Params: ContratoParams; Body: {
    clausulas?: string[]; valorMensal?: number; renovacaoAutomatica?: boolean;
  } }>('/organizations/:id/contracts/:contratoId', {
    schema: {
      params: {
        type: 'object',
        required: ['id', 'contratoId'],
        additionalProperties: false,
        properties: { id: schemaId, contratoId: schemaId },
      },
      ...schemaBody([], {
        clausulas: { type: 'array', items: { type: 'string' } },
        valorMensal: { type: 'number', minimum: 0 },
        renovacaoAutomatica: { type: 'boolean' },
      }),
    },
    preHandler: comPermissao(cadastro),
  }, async (request) => executar(() => organizacoes.atualizarContrato(
    request.params.id,
    request.params.contratoId,
    request.body,
    responsavel(request),
  )));

  app.post<{ Params: IdentificadorParams; Body: { novoVencimento: string } }>(
    '/organizations/:id/contracts/renew',
    {
      schema: {
        ...schemaParamsId,
        ...schemaBody(['novoVencimento'], { novoVencimento: schemaData }),
      },
      preHandler: comPermissao(cadastro),
    },
    async (request) => executar(() => organizacoes.renovarContrato(
      request.params.id,
      data(request.body.novoVencimento),
      responsavel(request),
    )),
  );

  app.post<{ Params: ContratoParams }>('/organizations/:id/contracts/:contratoId/cancel', {
    schema: {
      params: {
        type: 'object',
        required: ['id', 'contratoId'],
        additionalProperties: false,
        properties: { id: schemaId, contratoId: schemaId },
      },
    },
    preHandler: comPermissao(cadastro),
  }, async (request, reply) => {
    await executar(() => organizacoes.cancelarContrato(
      request.params.id,
      request.params.contratoId,
      responsavel(request),
    ));
    return reply.code(204).send();
  });

  app.post<{ Params: IdentificadorParams }>('/organizations/:id/contracts/close', {
    schema: schemaParamsId,
    preHandler: comPermissao(cadastro),
  }, async (request, reply) => {
    await executar(() => organizacoes.encerrarContrato(request.params.id, responsavel(request)));
    return reply.code(204).send();
  });

  app.get<{ Querystring: {
    organizacaoId?: string; dataInicio?: string; dataFim?: string;
    status?: StatusLote; incluirCancelados?: boolean;
  } }>('/lots', {
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          organizacaoId: schemaId,
          dataInicio: schemaData,
          dataFim: schemaData,
          status: schemaEnum(StatusLote),
          incluirCancelados: { type: 'boolean' },
        },
      },
    },
    preHandler: comPermissao(leituraOperacional),
  }, async (request) => {
    const query = request.query;
    return executar(() => lotes.listarLotes({
      organizacaoId: query.organizacaoId,
      dataInicio: query.dataInicio ? data(query.dataInicio) : undefined,
      dataFim: query.dataFim ? data(query.dataFim) : undefined,
      status: query.status,
      incluirCancelados: query.incluirCancelados ?? false,
    }));
  });

  app.post<{ Body: LoteBody }>('/lots', {
    schema: schemaBody(['id', 'dataEntrada', 'organizacaoId', 'notaFiscal', 'transportadora'], {
      id: schemaNaoVazio,
      dataEntrada: schemaData,
      organizacaoId: schemaNaoVazio,
      notaFiscal: schemaNaoVazio,
      transportadora: schemaNaoVazio,
      observacoes: schemaString,
    }),
    preHandler: comPermissao(almoxarifado),
  }, async (request, reply) => {
    const resultado = await executar(() => lotes.criarLote(
      { ...request.body, dataEntrada: data(request.body.dataEntrada) },
      responsavel(request),
    ));
    return reply.code(201).send(resultado);
  });

  app.post<{ Body: LoteBody & { equipamentos: EquipamentoBody[] } }>('/lots/with-equipment', {
    schema: schemaBody(
      ['id', 'dataEntrada', 'organizacaoId', 'notaFiscal', 'transportadora', 'equipamentos'],
      {
        id: schemaNaoVazio,
        dataEntrada: schemaData,
        organizacaoId: schemaNaoVazio,
        notaFiscal: schemaNaoVazio,
        transportadora: schemaNaoVazio,
        observacoes: schemaString,
        equipamentos: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: Object.keys(schemaEquipamento),
            additionalProperties: false,
            properties: schemaEquipamento,
          },
        },
      },
    ),
    preHandler: comPermissao(almoxarifado),
  }, async (request, reply) => {
    const { equipamentos: itens, ...dadosLote } = request.body;
    const resultado = await executar(() => lotes.criarLoteComEquipamentos(
      { ...dadosLote, dataEntrada: data(dadosLote.dataEntrada) },
      itens,
      responsavel(request),
    ));
    return reply.code(201).send(resultado);
  });

  app.get<{ Params: IdentificadorParams }>('/lots/:id', {
    schema: schemaParamsId,
    preHandler: comPermissao(leituraOperacional),
  }, async (request) => executar(() => lotes.buscarLote(request.params.id)));

  app.patch<{ Params: IdentificadorParams; Body: {
    dataEntrada?: string; notaFiscal?: string; transportadora?: string; observacoes?: string;
  } }>('/lots/:id', {
    schema: {
      ...schemaParamsId,
      ...schemaBody([], {
        dataEntrada: schemaData,
        notaFiscal: schemaNaoVazio,
        transportadora: schemaNaoVazio,
        observacoes: schemaString,
      }),
    },
    preHandler: comPermissao(almoxarifado),
  }, async (request) => executar(() => lotes.atualizarLote(
    request.params.id,
    { ...request.body, dataEntrada: request.body.dataEntrada ? data(request.body.dataEntrada) : undefined },
    responsavel(request),
  )));

  app.post<{ Params: IdentificadorParams }>('/lots/:id/triage', {
    schema: schemaParamsId,
    preHandler: comPermissao(almoxarifado),
  }, async (request, reply) => {
    await executar(() => lotes.processarTriagem(request.params.id, responsavel(request)));
    return reply.code(204).send();
  });

  app.post<{ Params: IdentificadorParams; Body: EquipamentoBody }>('/lots/:id/equipment', {
    schema: { ...schemaParamsId, ...schemaBody(Object.keys(schemaEquipamento), schemaEquipamento) },
    preHandler: comPermissao(almoxarifado),
  }, async (request, reply) => {
    const resultado = await executar(() => lotes.adicionarEquipamentoLote(
      request.params.id,
      request.body,
      responsavel(request),
    ));
    return reply.code(201).send(resultado);
  });

  app.delete<{ Params: IdentificadorParams; Body: { motivo: string } }>('/lots/:id', {
    schema: { ...schemaParamsId, ...schemaBody(['motivo'], { motivo: schemaNaoVazio }) },
    preHandler: comPermissao(almoxarifado),
  }, async (request, reply) => {
    await executar(() => lotes.cancelarLote(request.params.id, request.body.motivo, responsavel(request)));
    return reply.code(204).send();
  });

  app.get<{ Querystring: {
    loteId?: string; status?: StatusRastreamento; incluirCancelados?: boolean;
  } }>('/equipment', {
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          loteId: schemaId,
          status: schemaEnum(StatusRastreamento),
          incluirCancelados: { type: 'boolean' },
        },
      },
    },
    preHandler: comPermissao(leituraOperacional),
  }, async (request) => {
    const query = request.query;
    return executar(() => equipamentos.listarEquipamentos({
      loteId: query.loteId,
      status: query.status,
      incluirCancelados: query.incluirCancelados ?? false,
    }));
  });

  app.get<{ Params: IdentificadorParams }>('/equipment/:id', {
    schema: schemaParamsId,
    preHandler: comPermissao(leituraOperacional),
  }, async (request) => executar(() => equipamentos.consultarEquipamento(request.params.id)));

  app.get<{ Params: IdentificadorParams }>('/equipment/:id/tracking', {
    schema: schemaParamsId,
    preHandler: comPermissao(leituraOperacional),
  }, async (request) => executar(() => equipamentos.rastrearEquipamento(request.params.id)));

  app.patch<{ Params: IdentificadorParams; Body: {
    marca?: string; modelo?: string; anoFabricacao?: number; pesoQuilogramas?: number;
  } }>('/equipment/:id', {
    schema: {
      ...schemaParamsId,
      ...schemaBody([], {
        marca: schemaNaoVazio,
        modelo: schemaNaoVazio,
        anoFabricacao: { type: 'integer', minimum: 1900, maximum: new Date().getFullYear() },
        pesoQuilogramas: { type: 'number', exclusiveMinimum: 0 },
      }),
    },
    preHandler: comPermissao(almoxarifado),
  }, async (request) => executar(() => equipamentos.atualizarEquipamento(
    request.params.id,
    request.body,
    responsavel(request),
  )));

  app.patch<{ Params: IdentificadorParams; Body: { status: StatusRastreamento } }>('/equipment/:id/status', {
    schema: { ...schemaParamsId, ...schemaBody(['status'], { status: schemaEnum(StatusRastreamento) }) },
    preHandler: comPermissao(almoxarifado),
  }, async (request, reply) => {
    await executar(() => equipamentos.atualizarStatusRastreamento(
      request.params.id,
      request.body.status,
      responsavel(request),
    ));
    return reply.code(204).send();
  });

  app.patch<{ Params: IdentificadorParams; Body: { estadoFisico: EstadoFisico; justificativa?: string } }>(
    '/equipment/:id/physical-state',
    {
      schema: {
        ...schemaParamsId,
        ...schemaBody(['estadoFisico'], {
          estadoFisico: schemaEnum(EstadoFisico),
          justificativa: schemaString,
        }),
      },
      preHandler: comPermissao(almoxarifado),
    },
    async (request, reply) => {
      await executar(() => equipamentos.atualizarEstadoFisico(
        request.params.id,
        request.body.estadoFisico,
        request.body.justificativa,
        responsavel(request),
      ));
      return reply.code(204).send();
    },
  );

  app.post<{ Params: IdentificadorParams; Body: { destino: string } }>('/equipment/:id/movements', {
    schema: { ...schemaParamsId, ...schemaBody(['destino'], { destino: schemaNaoVazio }) },
    preHandler: comPermissao(almoxarifado),
  }, async (request, reply) => {
    await executar(() => equipamentos.registrarMovimentacao(
      request.params.id,
      request.body.destino,
      responsavel(request),
    ));
    return reply.code(204).send();
  });

  app.post<{ Params: IdentificadorParams; Body: {
    movimentacaoId: string; destino: string; justificativa: string;
  } }>('/equipment/:id/movements/corrections', {
    schema: {
      ...schemaParamsId,
      ...schemaBody(['movimentacaoId', 'destino', 'justificativa'], {
        movimentacaoId: schemaNaoVazio,
        destino: schemaNaoVazio,
        justificativa: schemaNaoVazio,
      }),
    },
    preHandler: comPermissao(almoxarifado),
  }, async (request, reply) => {
    await executar(() => equipamentos.corrigirMovimentacao(
      request.params.id,
      request.body.movimentacaoId,
      request.body.destino,
      responsavel(request),
      request.body.justificativa,
    ));
    return reply.code(204).send();
  });

  app.post<{ Params: IdentificadorParams; Body: { movimentacaoId: string; justificativa: string } }>(
    '/equipment/:id/movements/reversals',
    {
      schema: {
        ...schemaParamsId,
        ...schemaBody(['movimentacaoId', 'justificativa'], {
          movimentacaoId: schemaNaoVazio,
          justificativa: schemaNaoVazio,
        }),
      },
      preHandler: comPermissao(almoxarifado),
    },
    async (request, reply) => {
      await executar(() => equipamentos.estornarMovimentacao(
        request.params.id,
        request.body.movimentacaoId,
        responsavel(request),
        request.body.justificativa,
      ));
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: IdentificadorParams; Body: { motivo: string } }>('/equipment/:id', {
    schema: { ...schemaParamsId, ...schemaBody(['motivo'], { motivo: schemaNaoVazio }) },
    preHandler: comPermissao(almoxarifado),
  }, async (request, reply) => {
    await executar(() => equipamentos.cancelarEquipamento(
      request.params.id,
      request.body.motivo,
      responsavel(request),
    ));
    return reply.code(204).send();
  });

  app.get('/global-parameters', { preHandler: comPermissao(admin) }, async (request) => (
    executar(() => parametros.consultar(responsavel(request)))
  ));
  app.get('/global-parameters/history', { preHandler: comPermissao(admin) }, async (request) => (
    executar(() => parametros.listarHistorico(responsavel(request)))
  ));
  app.patch<{ Body: {
    imposto?: string; aliquota?: number; coeficienteDepreciacao?: number;
  } }>('/global-parameters', {
    schema: schemaBody([], {
      imposto: schemaNaoVazio,
      aliquota: { type: 'number', minimum: 0, maximum: 1 },
      coeficienteDepreciacao: { type: 'number', minimum: 0, maximum: 1 },
    }),
    preHandler: comPermissao(admin),
  }, async (request) => executar(() => parametros.atualizar(
    responsavel(request),
    request.body,
    responsavel(request),
  )));

  app.get<{ Querystring: { status: StatusRastreamento } }>('/reports/status', {
    schema: {
      querystring: {
        type: 'object',
        required: ['status'],
        additionalProperties: false,
        properties: { status: schemaEnum(StatusRastreamento) },
      },
    },
    preHandler: comPermissao(auditoria),
  }, async (request) => executar(() => relatorios.gerarRelatorioPorStatus(request.query.status)));

  app.get<{ Params: IdentificadorParams; Querystring: PeriodoQuery }>('/reports/organizations/:id', {
    schema: {
      ...schemaParamsId,
      querystring: {
        type: 'object',
        required: ['inicio', 'fim'],
        additionalProperties: false,
        properties: { inicio: schemaData, fim: schemaData },
      },
    },
    preHandler: comPermissao(auditoria),
  }, async (request) => executar(() => relatorios.gerarRelatorioPorOrganizacao(
    request.params.id,
    periodo(request.query),
  )));

  app.get<{ Querystring: PeriodoQuery }>('/reports/financial', {
    schema: {
      querystring: {
        type: 'object',
        required: ['inicio', 'fim'],
        additionalProperties: false,
        properties: { inicio: schemaData, fim: schemaData },
      },
    },
    preHandler: comPermissao(auditoria),
  }, async (request) => executar(() => relatorios.gerarRelatorioFinanceiro(periodo(request.query))));

  app.get<{ Querystring: PeriodoQuery }>('/reports/audit', {
    schema: {
      querystring: {
        type: 'object',
        required: ['inicio', 'fim'],
        additionalProperties: false,
        properties: { inicio: schemaData, fim: schemaData },
      },
    },
    preHandler: comPermissao(auditoria),
  }, async (request) => executar(() => relatorios.gerarRelatorioAuditoria(periodo(request.query))));
}
