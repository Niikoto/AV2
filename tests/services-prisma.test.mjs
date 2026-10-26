import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import {
  EstadoFisico,
  PapelUsuario,
  StatusRastreamento,
  TipoEquipamento,
} from '../dist/generated/prisma/enums.js';
import { ServicoAutenticacaoPrisma } from '../dist/services/prisma/ServicoAutenticacaoPrisma.js';
import { ServicoAuditoriaPrisma } from '../dist/services/prisma/ServicoAuditoriaPrisma.js';
import { ServicoEquipamentoPrisma } from '../dist/services/prisma/ServicoEquipamentoPrisma.js';
import { ServicoLotePrisma } from '../dist/services/prisma/ServicoLotePrisma.js';
import { ServicoOrganizacaoPrisma } from '../dist/services/prisma/ServicoOrganizacaoPrisma.js';
import { ServicoParametrosGlobaisPrisma } from '../dist/services/prisma/ServicoParametrosGlobaisPrisma.js';
import { ServicoRelatorioPrisma } from '../dist/services/prisma/ServicoRelatorioPrisma.js';

function gerarCnpj() {
  const base = `${Math.floor(Math.random() * 100_000_000).toString().padStart(8, '0')}0001`;
  const calcularDigito = (digitos, pesos) => {
    const soma = [...digitos].reduce((total, digito, indice) => (
      total + Number(digito) * pesos[indice]
    ), 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = calcularDigito(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const segundo = calcularDigito(`${base}${primeiro}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${primeiro}${segundo}`;
}

test('serviço Prisma de autenticação protege gestão de credenciais e não publica hashes', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const prefixo = `PRISMA-SERVICE-${randomUUID()}`;
  const administradorId = `${prefixo}-ADMIN`;
  const usuarioAdministrador = `${prefixo}-admin`;
  const servico = new ServicoAutenticacaoPrisma(prisma);
  const salt = randomUUID();
  const usuarioIds = [];

  try {
    await prisma.$connect();
    await prisma.credencial.create({
      data: {
        id: administradorId,
        usuario: usuarioAdministrador,
        nomeExibicao: 'Admin de teste',
        hashSenha: 'hash-de-teste',
        salt,
        ultimoAcesso: new Date(),
        papel: PapelUsuario.ADMINISTRADOR,
      },
    });

    const usuario = await servico.criarCredencial(
      `${prefixo}-auditor`,
      'senha-inicial',
      PapelUsuario.AUDITOR,
      'Auditor de teste',
      administradorId,
    );
    assert.equal(usuario.papel, PapelUsuario.AUDITOR);
    usuarioIds.push(usuario.id);
    await assert.rejects(
      servico.criarCredencial(`${prefixo}-sem-autorizacao`, 'senha', PapelUsuario.AUDITOR),
      /sessão administrativa/i,
    );
    const usuarioConcorrente = `${prefixo}-concorrente`;
    const criacoesConcorrentes = await Promise.allSettled([
      servico.criarCredencial(usuarioConcorrente, 'senha-1', PapelUsuario.AUDITOR, usuarioConcorrente, administradorId),
      servico.criarCredencial(usuarioConcorrente, 'senha-2', PapelUsuario.AUDITOR, usuarioConcorrente, administradorId),
    ]);
    const criadasConcorrentemente = criacoesConcorrentes.filter((resultado) => resultado.status === 'fulfilled');
    assert.equal(criadasConcorrentemente.length, 1);
    if (criadasConcorrentemente[0].status === 'fulfilled') {
      usuarioIds.push(criadasConcorrentemente[0].value.id);
    }

    const credenciais = await servico.listarCredenciais(administradorId);
    assert.equal(credenciais.some((credencial) => 'hashSenha' in credencial || 'salt' in credencial), false);
    assert.equal((await servico.buscarCredencial(usuario.id, administradorId)).usuario, `${prefixo}-auditor`);

    await servico.alterarNomeExibicao(usuario.id, 'Nome atualizado', administradorId);
    await servico.redefinirSenha(usuario.id, 'senha-nova', administradorId);
    assert.equal((await servico.autenticar(`${prefixo}-auditor`, 'senha-nova')).nomeExibicao, 'Nome atualizado');
    await assert.rejects(servico.autenticar(`${prefixo}-auditor`, 'senha-inicial'), /inválidos/i);

    await servico.alterarPapel(usuario.id, PapelUsuario.GESTOR_ALMOXARIFADO, administradorId);
    assert.equal(await servico.possuiPermissao(usuario.id, 'GERENCIAR_LOTES'), true);
    await servico.desativarCredencial(usuario.id, administradorId);
    await assert.rejects(servico.autenticar(`${prefixo}-auditor`, 'senha-nova'), /inválidos/i);
    const outrosAdministradoresAtivos = await prisma.credencial.count({
      where: {
        ativo: true,
        papel: PapelUsuario.ADMINISTRADOR,
        id: { not: administradorId },
      },
    });
    if (outrosAdministradoresAtivos === 0) {
      await assert.rejects(
        servico.desativarCredencial(usuarioAdministrador, administradorId),
        /último administrador/i,
      );
    } else {
      await servico.desativarCredencial(usuarioAdministrador, administradorId);
      assert.equal((await prisma.credencial.findUnique({ where: { id: administradorId } }))?.ativo, false);
    }
  } finally {
    await prisma.eventoAuditoria.deleteMany({
      where: { usuarioResponsavel: { in: [administradorId, ...usuarioIds] } },
    });
    await prisma.credencial.deleteMany({
      where: {
        OR: [
          { id: administradorId },
          { usuario: { startsWith: prefixo } },
          { id: { in: usuarioIds } },
        ],
      },
    });
    await prisma.$disconnect();
  }
});

test('serviços Prisma persistem triagem e movimentações como uma jornada consistente', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const prefixo = `PRISMA-SERVICE-${randomUUID()}`;
  let conectado = false;

  try {
    await prisma.$connect();
    conectado = true;
    const organizacoes = new ServicoOrganizacaoPrisma(prisma);
    const lotes = new ServicoLotePrisma(prisma);
    const equipamentos = new ServicoEquipamentoPrisma(prisma, lotes);

    const cnpjConcorrente = gerarCnpj();
    const dadosOrganizacaoConcorrente = (id, cnpj) => ({
      id,
      razaoSocial: 'Organização concorrente',
      cnpj,
      inscricaoEstadual: 'ISENTO',
      enderecoCompleto: 'Endereço de teste',
      telefone: '0000000000',
      email: 'prisma-test@example.invalid',
    });
    const concorrenciaCnpj = await Promise.allSettled([
      organizacoes.cadastrarOrganizacao(
        dadosOrganizacaoConcorrente(`${prefixo}-CNPJ-A`, cnpjConcorrente),
        prefixo,
      ),
      organizacoes.cadastrarOrganizacao(
        dadosOrganizacaoConcorrente(
          `${prefixo}-CNPJ-B`,
          `${cnpjConcorrente.slice(0, 2)}.${cnpjConcorrente.slice(2, 5)}.${cnpjConcorrente.slice(5, 8)}/${cnpjConcorrente.slice(8, 12)}-${cnpjConcorrente.slice(12)}`,
        ),
        prefixo,
      ),
    ]);
    assert.equal(concorrenciaCnpj.filter((resultado) => resultado.status === 'fulfilled').length, 1);
    assert.equal(
      await prisma.organizacao.count({ where: { cnpjNormalizado: cnpjConcorrente } }),
      1,
    );

    await organizacoes.cadastrarOrganizacao({
      id: `${prefixo}-ORG`,
      razaoSocial: 'Organização de teste Prisma',
      cnpj: gerarCnpj(),
      inscricaoEstadual: 'ISENTO',
      enderecoCompleto: 'Endereço de teste',
      telefone: '0000000000',
      email: 'prisma-test@example.invalid',
    }, prefixo);

    const batchEquipamentos = ['A', 'B'].map((sufixo) => ({
      id: `${prefixo}-BATCH-EQUIP-${sufixo}`,
      codigoBarrasInterno: `${prefixo}-BATCH-BARCODE-${sufixo}`,
      tipo: TipoEquipamento.NOTEBOOK,
      marca: 'Marca teste',
      modelo: 'Modelo teste',
      anoFabricacao: new Date().getFullYear(),
      estadoFisico: EstadoFisico.BOM_ESTADO,
      pesoQuilogramas: 2,
    }));
    const loteComEquipamentos = await lotes.criarLoteComEquipamentos({
      id: `${prefixo}-BATCH-LOT`,
      dataEntrada: new Date(),
      organizacaoId: `${prefixo}-ORG`,
      notaFiscal: 'NF-BATCH',
      transportadora: 'Transportadora de teste',
    }, batchEquipamentos, prefixo);
    assert.deepEqual(loteComEquipamentos.equipamentos.map((item) => item.posicaoNoLote), [1, 2]);

    const loteParaRollback = `${prefixo}-ROLLBACK-LOT`;
    await assert.rejects(lotes.criarLoteComEquipamentos({
      id: loteParaRollback,
      dataEntrada: new Date(),
      organizacaoId: `${prefixo}-ORG`,
      notaFiscal: 'NF-ROLLBACK',
      transportadora: 'Transportadora de teste',
    }, [
      { ...batchEquipamentos[0], id: `${prefixo}-DUPLICATE-ID`, codigoBarrasInterno: `${prefixo}-ROLLBACK-BARCODE-A` },
      { ...batchEquipamentos[1], id: `${prefixo}-DUPLICATE-ID`, codigoBarrasInterno: `${prefixo}-ROLLBACK-BARCODE-B` },
    ], prefixo));
    assert.equal(await prisma.lote.count({ where: { id: loteParaRollback } }), 0);
    assert.equal(await prisma.equipamento.count({ where: { id: `${prefixo}-DUPLICATE-ID` } }), 0);

    const assinatura = new Date(Date.now() - 60_000);
    const vencimento = new Date(Date.now() + 30 * 86400_000);
    const relatorios = new ServicoRelatorioPrisma(prisma);
    const periodoFinanceiro = { inicio: new Date(), fim: new Date(Date.now() + 60 * 86400_000) };
    const relatorioFinanceiroAntes = await relatorios.gerarRelatorioFinanceiro(periodoFinanceiro);
    const valorMensalAntes = Number(
      /Valor mensal contratado: R\$ ([\d.]+)/.exec(relatorioFinanceiroAntes)?.[1],
    );
    assert.ok(Number.isFinite(valorMensalAntes));
    await organizacoes.cadastrarContrato(`${prefixo}-ORG`, {
      id: `${prefixo}-CONTRATO`,
      dataAssinatura: assinatura,
      dataVencimento: vencimento,
      valorMensal: 1250,
      clausulas: ['Cláusula de teste'],
    }, prefixo);
    const novoVencimento = new Date(Date.now() + 60 * 86400_000);
    await organizacoes.renovarContrato(`${prefixo}-ORG`, novoVencimento, prefixo);
    assert.equal((await organizacoes.listarContratos(`${prefixo}-ORG`))[0].historicoRenovacoes.length, 1);

    await lotes.criarLote({
      id: `${prefixo}-LOTE`,
      dataEntrada: new Date(),
      organizacaoId: `${prefixo}-ORG`,
      notaFiscal: 'NF-TESTE',
      transportadora: 'Transportadora de teste',
    }, prefixo);
    await lotes.adicionarEquipamentoLote(`${prefixo}-LOTE`, {
      id: `${prefixo}-EQUIP`,
      codigoBarrasInterno: `${prefixo}-BARCODE`,
      tipo: TipoEquipamento.NOTEBOOK,
      marca: 'Marca teste',
      modelo: 'Modelo teste',
      anoFabricacao: new Date().getFullYear(),
      estadoFisico: EstadoFisico.BOM_ESTADO,
      pesoQuilogramas: 2,
    }, prefixo);

    const loteConcorrente = `${prefixo}-CONCURRENT-LOT`;
    await lotes.criarLoteComEquipamentos({
      id: loteConcorrente,
      dataEntrada: new Date(),
      organizacaoId: `${prefixo}-ORG`,
      notaFiscal: 'NF-CONCURRENT',
      transportadora: 'Transportadora de teste',
    }, [{
      id: `${prefixo}-CONCURRENT-EQUIP-1`,
      codigoBarrasInterno: `${prefixo}-CONCURRENT-BARCODE-1`,
      tipo: TipoEquipamento.NOTEBOOK,
      marca: 'Marca teste',
      modelo: 'Modelo teste',
      anoFabricacao: new Date().getFullYear(),
      estadoFisico: EstadoFisico.BOM_ESTADO,
      pesoQuilogramas: 2,
    }], prefixo);
    const corridaAdicionarTriagem = await Promise.allSettled([
      lotes.adicionarEquipamentoLote(loteConcorrente, {
        id: `${prefixo}-CONCURRENT-EQUIP-2`,
        codigoBarrasInterno: `${prefixo}-CONCURRENT-BARCODE-2`,
        tipo: TipoEquipamento.NOTEBOOK,
        marca: 'Marca teste',
        modelo: 'Modelo teste',
        anoFabricacao: new Date().getFullYear(),
        estadoFisico: EstadoFisico.BOM_ESTADO,
        pesoQuilogramas: 2,
      }, prefixo),
      lotes.processarTriagem(loteConcorrente, prefixo),
    ]);
    assert.ok(corridaAdicionarTriagem.some((resultado) => resultado.status === 'fulfilled'));
    const loteConcorrenteAtual = await lotes.buscarLote(loteConcorrente);
    if (loteConcorrenteAtual.statusProcessamento === 'TRIAGEM_CONCLUIDA') {
      assert.ok(loteConcorrenteAtual.equipamentos.every(
        (equipamento) => equipamento.statusRastreamento === StatusRastreamento.AGUARDANDO_DESMONTE,
      ));
    } else {
      assert.ok(loteConcorrenteAtual.equipamentos.every(
        (equipamento) => equipamento.statusRastreamento === StatusRastreamento.AGUARDANDO_TRIAGEM,
      ));
    }

    await lotes.processarTriagem(`${prefixo}-LOTE`, prefixo);
    assert.equal(
      (await equipamentos.consultarEquipamento(`${prefixo}-EQUIP`)).statusRastreamento,
      StatusRastreamento.AGUARDANDO_DESMONTE,
    );
    const transicoesConcorrentes = await Promise.allSettled([
      equipamentos.atualizarStatusRastreamento(
        `${prefixo}-BARCODE`,
        StatusRastreamento.EM_DESMONTE,
        prefixo,
      ),
      equipamentos.atualizarStatusRastreamento(
        `${prefixo}-EQUIP`,
        StatusRastreamento.EM_DESMONTE,
        prefixo,
      ),
    ]);
    assert.equal(
      transicoesConcorrentes.filter((resultado) => resultado.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      await prisma.movimentacao.count({ where: { equipamentoId: `${prefixo}-EQUIP` } }),
      1,
    );
    const rastreamento = await equipamentos.rastrearEquipamento(`${prefixo}-EQUIP`);
    assert.equal(rastreamento.localizacaoAtual, '');
    assert.equal(
      rastreamento.linhaDoTempo.some((evento) => evento.tipo === 'RENOVACAO_CONTRATO'),
      true,
    );
    const periodo = { inicio: new Date(Date.now() - 86400_000), fim: new Date(Date.now() + 86400_000) };
    const quantidadeEquipamentos = await prisma.equipamento.count({
      where: { lote: { organizacaoId: `${prefixo}-ORG` }, cancelado: false },
    });
    assert.match(
      await relatorios.gerarRelatorioPorOrganizacao(`${prefixo}-ORG`, periodo),
      new RegExp(`Equipamentos nos lotes: ${quantidadeEquipamentos}`),
    );
    assert.match(
      await relatorios.gerarRelatorioFinanceiro({
        inicio: new Date(),
        fim: novoVencimento,
      }),
      new RegExp(`Valor mensal contratado: R\\$ ${(valorMensalAntes + 1250).toFixed(2)}`),
    );
    assert.match(
      await relatorios.gerarRelatorioPorStatus(StatusRastreamento.EM_DESMONTE),
      new RegExp(`${prefixo}-EQUIP`),
    );
    const relatorioAuditoria = await relatorios.gerarRelatorioAuditoria(periodo);
    assert.match(relatorioAuditoria, /RENOVAR contrato/);
    assert.match(relatorioAuditoria, /ALTERAR_STATUS equipamento/);
  } finally {
    if (conectado) {
      const encontrados = await prisma.equipamento.findMany({
        where: { id: { startsWith: prefixo } },
        select: { id: true },
      });
      const equipamentoIds = encontrados.map((item) => item.id);
      await prisma.movimentacao.deleteMany({ where: { equipamentoId: { in: equipamentoIds } } });
      await prisma.equipamento.deleteMany({ where: { id: { in: equipamentoIds } } });
      await prisma.lote.deleteMany({ where: { id: { startsWith: prefixo } } });
      await prisma.organizacao.updateMany({
        where: { id: { startsWith: prefixo } },
        data: { contratoVigenteId: null },
      });
      await prisma.contrato.deleteMany({ where: { organizacaoId: { startsWith: prefixo } } });
      await prisma.organizacao.deleteMany({ where: { id: { startsWith: prefixo } } });
      await prisma.eventoAuditoria.deleteMany({ where: { usuarioResponsavel: prefixo } });
    }
    await prisma.$disconnect();
  }
});

test('parâmetros globais e auditoria Prisma persistem versões em transações e geram relatórios', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const prefixo = `PRISMA-SERVICE-${randomUUID()}`;
  const administradorId = `${prefixo}-ADMIN`;
  let conectado = false;

  try {
    await prisma.$connect();
    conectado = true;
    await prisma.credencial.create({
      data: {
        id: administradorId,
        usuario: `${prefixo}-admin`,
        nomeExibicao: 'Admin de parâmetros',
        hashSenha: 'hash-de-teste',
        salt: randomUUID(),
        ultimoAcesso: new Date(),
        papel: PapelUsuario.ADMINISTRADOR,
      },
    });

    const parametros = new ServicoParametrosGlobaisPrisma(prisma);
    const auditoria = new ServicoAuditoriaPrisma(prisma);
    const relatorios = new ServicoRelatorioPrisma(prisma);
    const atualAntes = await parametros.consultar(administradorId);
    await assert.rejects(parametros.consultar(`${prefixo}-desconhecido`), /permissão/i);
    await assert.rejects(
      parametros.atualizar(administradorId, { imposto: 'ICMS', aliquota: 1.1 }, 'teste'),
      /entre 0 e 1/i,
    );

    const primeiraVersao = await parametros.atualizar(
      administradorId,
      { imposto: ' icms ', aliquota: 0.18, coeficienteDepreciacao: 0.1 },
      `${prefixo}-responsavel`,
    );
    const segundaVersao = await parametros.atualizar(
      administradorId,
      { imposto: 'ISS', aliquota: 0.05 },
      `${prefixo}-responsavel`,
    );
    assert.equal(primeiraVersao.versao, atualAntes.versao + 1);
    assert.equal(segundaVersao.versao, atualAntes.versao + 2);
    assert.deepEqual(segundaVersao.aliquotasImpostos, { ICMS: 0.18, ISS: 0.05 });
    assert.deepEqual(
      (await parametros.listarHistorico(administradorId)).slice(-2).map((item) => item.versao),
      [atualAntes.versao + 1, atualAntes.versao + 2],
    );
    const impostosConcorrentes = ['A', 'B', 'C'].map((sufixo) => `T${randomUUID().slice(0, 6)}${sufixo}`);
    const atualizacoesConcorrentes = await Promise.allSettled(
      impostosConcorrentes.map((imposto, indice) => parametros.atualizar(
        administradorId,
        { imposto, aliquota: (indice + 1) / 100 },
        `${prefixo}-responsavel`,
      )),
    );
    const versoesConcorrentes = atualizacoesConcorrentes
      .filter((resultado) => resultado.status === 'fulfilled');
    const conflitosConcorrentes = atualizacoesConcorrentes
      .filter((resultado) => resultado.status === 'rejected');
    assert.ok(versoesConcorrentes.length > 0);
    assert.ok(conflitosConcorrentes.every((resultado) => /conflito/i.test(resultado.reason.message)));
    const taxasPersistidas = (await parametros.consultar(administradorId)).aliquotasImpostos;
    const impostosAceitos = atualizacoesConcorrentes
      .flatMap((resultado, indice) => resultado.status === 'fulfilled'
        ? [impostosConcorrentes[indice].toUpperCase()]
        : []);
    assert.ok(
      impostosAceitos.every((imposto) => imposto in taxasPersistidas),
      JSON.stringify({ impostosAceitos, taxasPersistidas }),
    );
    assert.equal(
      await auditoria.executar({
        operacao: 'TESTE_AUDITORIA',
        entidade: 'teste',
        usuarioResponsavel: administradorId,
        dadosDepois: { resultado: 'persistido' },
      }, async () => 'ok'),
      'ok',
    );

    const inicio = new Date(Date.now() - 60_000);
    const fim = new Date(Date.now() + 60_000);
    const auditoriaAntes = await auditoria.listar({ inicio, fim });
    const relatorioAuditoria = await relatorios.gerarRelatorioAuditoria({ inicio, fim });
    assert.match(relatorioAuditoria, /Relatório de auditoria/);
    assert.match(relatorioAuditoria, /ATUALIZAR parametros-globais/);
    assert.match(relatorioAuditoria, /TESTE_AUDITORIA teste/);
    assert.match(
      await relatorios.gerarRelatorioFinanceiro({ inicio, fim }),
      /Transações auditadas no período: \d+/,
    );

    const eventosAntesDoErro = await prisma.eventoAuditoria.count({
      where: { usuarioResponsavel: administradorId, timestamp: { gte: inicio, lte: fim } },
    });
    await assert.rejects(auditoria.executar(
      {
        operacao: 'TESTE_COM_FALHA',
        entidade: 'teste',
        usuarioResponsavel: administradorId,
      },
      async () => {
        throw new Error('falha simulada');
      },
    ), /falha simulada/);
    assert.equal(
      await prisma.eventoAuditoria.count({
        where: { usuarioResponsavel: administradorId, timestamp: { gte: inicio, lte: fim } },
      }),
      eventosAntesDoErro,
    );
  } finally {
    if (conectado) {
      await prisma.eventoAuditoria.deleteMany({ where: { usuarioResponsavel: administradorId } });
      await prisma.parametroGlobal.deleteMany({ where: { atualizadoPor: `${prefixo}-responsavel` } });
      await prisma.credencial.deleteMany({ where: { id: administradorId } });
    }
    await prisma.$disconnect();
  }
});
