import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ConfiguracaoSistema } from '../dist/config/ConfiguracaoSistema.js';
import { ProvisionamentoInicial } from '../dist/config/ProvisionamentoInicial.js';
import { Equipamento } from '../dist/domain/Equipamento.js';
import { CriptografiaArquivo } from '../dist/infra/CriptografiaArquivo.js';
import { JournalTransacao } from '../dist/infra/JournalTransacao.js';
import { RepositorioArquivo } from '../dist/infra/RepositorioArquivo.js';
import { ServicoAutenticacao } from '../dist/services/ServicoAutenticacao.js';
import { ServicoEquipamento } from '../dist/services/ServicoEquipamento.js';
import { ServicoLote } from '../dist/services/ServicoLote.js';
import { ServicoOrganizacao } from '../dist/services/ServicoOrganizacao.js';
import { ServicoParametrosGlobais } from '../dist/services/ServicoParametrosGlobais.js';
import { ServicoRelatorio } from '../dist/services/ServicoRelatorio.js';
import { EstadoFisico } from '../dist/types/EstadoFisico.js';
import { PapelUsuario } from '../dist/types/PapelUsuario.js';
import { StatusLote } from '../dist/types/StatusLote.js';
import { StatusRastreamento } from '../dist/types/StatusRastreamento.js';
import { TipoEquipamento } from '../dist/types/TipoEquipamento.js';
import { ValidadorCNPJ } from '../dist/validators/ValidadorCNPJ.js';
import { ValidadorDataEntrada } from '../dist/validators/ValidadorDataEntrada.js';

function criarContexto(opcoesRepositorio = {}) {
  const raiz = mkdtempSync(join(tmpdir(), 'greencode-av1-'));
  const criptografia = new CriptografiaArquivo();
  const configuracao = new ConfiguracaoSistema(join(raiz, 'configuracao-mestre.json'));
  const provisionamento = new ProvisionamentoInicial(configuracao, criptografia);
  const chave = provisionamento.provisionar('senha-admin-segura');
  const repositorio = new RepositorioArquivo(join(raiz, 'dados'), criptografia, chave, opcoesRepositorio);
  const autenticacao = new ServicoAutenticacao(repositorio);
  const organizacao = new ServicoOrganizacao(repositorio, new ValidadorCNPJ());
  const lote = new ServicoLote(repositorio, new ValidadorDataEntrada());
  const equipamento = new ServicoEquipamento(repositorio);
  return { raiz, configuracao, provisionamento, repositorio, autenticacao, organizacao, lote, equipamento };
}

function removerContexto(contexto) {
  rmSync(contexto.raiz, { recursive: true, force: true });
}

function cadastrarOrganizacao(servico, id = 'ORG-001') {
  return servico.cadastrarOrganizacao({
    id,
    razaoSocial: 'Organização Teste Ltda',
    cnpj: '04.252.011/0001-10',
    inscricaoEstadual: 'ISENTO',
    enderecoCompleto: 'Rua dos Testes, 1',
    telefone: '11999999999',
    email: 'teste@exemplo.com',
    contratoVigente: null,
  });
}

test('jornada completa: provisionamento, rastreabilidade e journal', () => {
  const contexto = criarContexto();
  try {
    assert.equal(existsSync(join(contexto.raiz, 'configuracao-mestre.json')), true);
    assert.equal(contexto.provisionamento.precisaProvisionar(), false);
    assert.equal(contexto.provisionamento.obterChaveMestra('senha-admin-segura').length, 64);

    contexto.autenticacao.criarCredencial('admin', 'senha-admin-segura', PapelUsuario.ADMINISTRADOR);
    const sessao = contexto.autenticacao.login('admin', 'senha-admin-segura');
    assert.equal(contexto.autenticacao.validarToken(sessao.token), true);
    contexto.repositorio.definirUsuarioResponsavel(sessao.usuarioId);

    const organizacao = cadastrarOrganizacao(contexto.organizacao);
    const dataAssinatura = new Date();
    const dataVencimento = new Date(dataAssinatura);
    dataVencimento.setFullYear(dataVencimento.getFullYear() + 1);
    const contrato = contexto.organizacao.cadastrarContrato('ORG-001', {
      id: 'CONTRATO-001',
      dataAssinatura,
      dataVencimento,
      clausulas: ['Coleta e destinação de equipamentos eletrônicos'],
      valorMensal: 1250,
      renovacaoAutomatica: false,
    });
    contexto.organizacao.atualizarContrato('ORG-001', contrato.id, { valorMensal: 1300 });

    contexto.lote.criarLote({ id: 'LOTE-001', dataEntrada: new Date(), organizacaoId: 'ORG-001', notaFiscal: 'NF-123', transportadora: 'TransRapida' });
    const equipamento = new Equipamento('EQ-001', contexto.equipamento.gerarCodigoBarras(TipoEquipamento.NOTEBOOK, 1), TipoEquipamento.NOTEBOOK, 'Marca', 'Modelo', 2024, EstadoFisico.BOM_ESTADO, 2.5, 'LOTE-001', 0, StatusRastreamento.AGUARDANDO_TRIAGEM, []);
    contexto.lote.adicionarEquipamentoLote('LOTE-001', equipamento);
    assert.equal(contexto.lote.listarLotes({ organizacaoId: organizacao.id, status: StatusLote.RECEBIDO }).length, 1);
    assert.equal(contexto.equipamento.consultarEquipamento(equipamento.codigoBarrasInterno).id, equipamento.id);
    assert.throws(
      () => contexto.equipamento.atualizarStatusRastreamento('EQ-001', StatusRastreamento.EM_DESMONTE, sessao.usuarioId),
      /Transição de status inválida/,
    );

    contexto.lote.processarTriagem('LOTE-001');
    contexto.equipamento.atualizarStatusRastreamento('EQ-001', StatusRastreamento.EM_DESMONTE, sessao.usuarioId);
    contexto.equipamento.registrarMovimentacao('EQ-001', 'Área de desmontagem', sessao.usuarioId);
    contexto.equipamento.registrarMovimentacao('EQ-001', 'Armazenamento intermediário', sessao.usuarioId);
    const movimentacaoCorrigida = contexto.equipamento.consultarEquipamento('EQ-001')
      .historicoMovimentacao.find((evento) => evento.destino === 'Armazenamento intermediário');
    contexto.equipamento.corrigirMovimentacao(
      'EQ-001',
      movimentacaoCorrigida.id,
      'Bancada de desmontagem',
      sessao.usuarioId,
      'Destino informado incorretamente no registro original.',
    );
    contexto.equipamento.atualizarStatusRastreamento('EQ-001', StatusRastreamento.PECAS_REAPROVEITADAS, sessao.usuarioId);
    contexto.equipamento.atualizarStatusRastreamento('EQ-001', StatusRastreamento.BAIXA_DEFINITIVA, sessao.usuarioId);

    const historico = contexto.equipamento.rastrearEquipamento('EQ-001');
    assert.equal(historico.equipamento.statusRastreamento, StatusRastreamento.BAIXA_DEFINITIVA);
    assert.equal(historico.lote.id, 'LOTE-001');
    assert.equal(historico.organizacao.id, 'ORG-001');
    assert.equal(historico.organizacao.contratos[0].valorMensal, 1300);
    assert.equal(historico.movimentacoes.some((evento) => evento.tipoEvento === 'CORRECAO' && evento.destinoCorrigido === 'Bancada de desmontagem'), true);
    assert.equal(historico.movimentacoes.filter((evento) => evento.tipoEvento === 'MOVIMENTACAO').length, 2);
    assert.equal(historico.localizacaoAtual, 'Bancada de desmontagem');
    assert.equal(historico.movimentacoes.find((evento) => evento.tipoEvento === 'MOVIMENTACAO').destino, 'Área de desmontagem');
    assert.equal(historico.movimentacoes.every((evento) => evento.responsavel === sessao.usuarioId), true);
    assert.equal(historico.linhaDoTempo.some((evento) => evento.tipo === 'CONTRATO'), true);
    assert.equal(historico.linhaDoTempo.some((evento) => evento.tipo === 'CORRECAO'), true);
    assert.deepEqual(
      historico.linhaDoTempo.map((evento) => evento.dataHora.getTime()),
      historico.linhaDoTempo.map((evento) => evento.dataHora.getTime()).toSorted((a, b) => a - b),
    );

    const journal = JournalTransacao.listar(contexto.repositorio);
    assert.equal(journal.some((transacao) => transacao.operacao === 'CRIAR' && transacao.entidade === 'organizacoes' && transacao.resultado === 'CONFIRMADA'), true);
    assert.equal(journal.some((transacao) => transacao.entidade === 'equipamentos' && transacao.usuarioResponsavel === sessao.usuarioId), true);
    assert.equal(journal.every((transacao) => transacao.resultado !== 'PENDENTE'), true);

    const relatorio = new ServicoRelatorio(contexto.repositorio);
    assert.match(relatorio.gerarRelatorioAuditoria({ inicio: new Date(0), fim: new Date(Date.now() + 1000) }), /responsável:/);
  } finally { removerContexto(contexto); }
});

test('estorno registra evento histórico e retorna à origem sem remover a movimentação', () => {
  const contexto = criarContexto();
  try {
    cadastrarOrganizacao(contexto.organizacao);
    contexto.lote.criarLote({ id: 'LOTE-001', dataEntrada: new Date(), organizacaoId: 'ORG-001', notaFiscal: 'NF-123', transportadora: 'TransRapida' });
    const equipamento = new Equipamento('EQ-001', 'GC-NOTEBOOK-000001', TipoEquipamento.NOTEBOOK, 'Marca', 'Modelo', 2024, EstadoFisico.BOM_ESTADO, 2.5, 'LOTE-001', 0, StatusRastreamento.AGUARDANDO_TRIAGEM, []);
    contexto.lote.adicionarEquipamentoLote('LOTE-001', equipamento);
    contexto.lote.processarTriagem('LOTE-001');
    contexto.equipamento.registrarMovimentacao('EQ-001', 'Área de desmontagem', 'operador-001');
    const original = contexto.equipamento.consultarEquipamento('EQ-001').historicoMovimentacao[0];

    contexto.equipamento.estornarMovimentacao('EQ-001', original.id, 'operador-001', 'Movimentação lançada por engano.');

    const rastreio = contexto.equipamento.rastrearEquipamento('EQ-001');
    assert.equal(rastreio.movimentacoes.length, 2);
    assert.equal(rastreio.movimentacoes[0].id, original.id);
    assert.equal(rastreio.movimentacoes[1].tipoEvento, 'ESTORNO');
    assert.equal(rastreio.movimentacoes[1].movimentacaoReferenciadaId, original.id);
    assert.equal(rastreio.localizacaoAtual, 'RECEBIMENTO');
  } finally { removerContexto(contexto); }
});

test('rejeita CNPJ inválido e CNPJ duplicado', () => {
  const contexto = criarContexto();
  try {
    assert.throws(() => contexto.organizacao.cadastrarOrganizacao({ id: 'INV', cnpj: '11111111111111' }), /CNPJ/);
    cadastrarOrganizacao(contexto.organizacao);
    assert.throws(() => cadastrarOrganizacao(contexto.organizacao, 'ORG-002'), /Já existe uma organização/);
  } finally { removerContexto(contexto); }
});

test('rejeita lote com data futura ou anterior a 90 dias', () => {
  const contexto = criarContexto();
  try {
    cadastrarOrganizacao(contexto.organizacao);
    const dados = { id: 'LOTE-DATA', organizacaoId: 'ORG-001', notaFiscal: 'NF', transportadora: 'Trans' };
    const amanha = new Date(); amanha.setDate(amanha.getDate() + 1);
    const antigo = new Date(); antigo.setDate(antigo.getDate() - 91);
    assert.throws(() => contexto.lote.criarLote({ ...dados, dataEntrada: amanha }), /futura/);
    assert.throws(() => contexto.lote.criarLote({ ...dados, id: 'LOTE-ANTIGO', dataEntrada: antigo }), /90 dias/);
  } finally { removerContexto(contexto); }
});

test('exige justificativa ao degradar estado físico em duas categorias', () => {
  const contexto = criarContexto();
  try {
    cadastrarOrganizacao(contexto.organizacao);
    contexto.lote.criarLote({ id: 'LOTE-001', dataEntrada: new Date(), organizacaoId: 'ORG-001', notaFiscal: 'NF', transportadora: 'Trans' });
    contexto.lote.adicionarEquipamentoLote('LOTE-001', new Equipamento('EQ-001', 'GC-NOTEBOOK-000001', TipoEquipamento.NOTEBOOK, 'Marca', 'Modelo', 2024, EstadoFisico.BOM_ESTADO, 1, 'LOTE-001', 0, StatusRastreamento.AGUARDANDO_TRIAGEM, []));
    assert.throws(() => contexto.equipamento.atualizarEstadoFisico('EQ-001', EstadoFisico.USADO_MODERADO), /Justificativa obrigatória/);
    contexto.equipamento.atualizarEstadoFisico('EQ-001', EstadoFisico.USADO_MODERADO, 'Dano identificado na inspeção.');
    assert.equal(contexto.equipamento.rastrearEquipamento('EQ-001').equipamento.estadoFisico, EstadoFisico.USADO_MODERADO);
  } finally { removerContexto(contexto); }
});

test('rejeita senha incorreta, usuário sem permissão e sessão expirada', () => {
  const contexto = criarContexto();
  try {
    contexto.autenticacao.criarCredencial('admin', 'senha-admin', PapelUsuario.ADMINISTRADOR);
    const sessaoAdmin = contexto.autenticacao.login('admin', 'senha-admin');
    contexto.autenticacao.criarCredencial('auditor', 'senha-auditor', PapelUsuario.AUDITOR, 'Auditor de Teste', sessaoAdmin.token);
    assert.throws(() => contexto.autenticacao.login('auditor', 'incorreta'), /inválidos/);
    const sessao = contexto.autenticacao.login('auditor', 'senha-auditor');
    assert.equal(contexto.autenticacao.possuiPermissao(sessao.token, 'GERAR_RELATORIOS'), true);
    assert.equal(contexto.autenticacao.possuiPermissao(sessao.token, 'GERENCIAR_LOTES'), false);
    assert.throws(
      () => contexto.autenticacao.criarCredencial('bloqueado', 'senha', PapelUsuario.OPERADOR_CADASTRO, 'Bloqueado', sessao.token),
      /permissão/,
    );
    assert.throws(() => contexto.autenticacao.listarCredenciais(sessao.token), /permissão/);
    assert.throws(() => contexto.autenticacao.alterarSenha(sessao.token, 'senha-auditor', 'nova-senha'), /somente para consulta/);
    sessao.expiracao = new Date(Date.now() - 1);
    assert.equal(contexto.autenticacao.validarToken(sessao.token), false);
  } finally { removerContexto(contexto); }
});

test('administrador consulta, atualiza e desativa contas preservando uma referência anônima', () => {
  const contexto = criarContexto();
  try {
    contexto.autenticacao.criarCredencial('admin', 'senha-admin', PapelUsuario.ADMINISTRADOR, 'Admin');
    const admin = contexto.autenticacao.login('admin', 'senha-admin');
    contexto.autenticacao.criarCredencial('operador', 'senha-operador', PapelUsuario.OPERADOR_CADASTRO, 'Operador Um', admin.token);

    const consultado = contexto.autenticacao.buscarCredencial('operador', admin.token);
    assert.equal(consultado.nomeExibicao, 'Operador Um');
    assert.equal('hashSenha' in consultado, false);
    contexto.autenticacao.alterarNomeExibicao('operador', 'Operador Dois', admin.token);
    contexto.autenticacao.alterarPapel('operador', PapelUsuario.GESTOR_ALMOXARIFADO, admin.token);
    contexto.autenticacao.redefinirSenha('operador', 'senha-nova', admin.token);
    assert.throws(() => contexto.autenticacao.login('operador', 'senha-operador'), /inválidos/);
    contexto.autenticacao.login('operador', 'senha-nova');

    const antesDeDesativar = contexto.autenticacao.buscarCredencial('operador', admin.token);
    contexto.autenticacao.desativarCredencial('operador', admin.token);
    assert.throws(() => contexto.autenticacao.login('operador', 'senha-nova'), /inválidos/);
    const tombstone = contexto.repositorio.carregarEntidade('credenciais', antesDeDesativar.id);
    assert.equal(tombstone.ativo, false);
    assert.equal(tombstone.usuario, '');
    assert.equal(tombstone.nomeExibicao, '');
    assert.equal(tombstone.hashSenha, '');
    assert.equal(tombstone.salt, '');
    const eventoDesativacao = JournalTransacao.listar(contexto.repositorio)
      .find((item) => item.entidade === 'credenciais' && item.dadosDepois?.ativo === false);
    assert.equal(eventoDesativacao.dadosAntes.usuario, undefined);
    assert.equal(eventoDesativacao.dadosAntes.hashSenha, undefined);
    assert.equal(eventoDesativacao.dadosDepois.usuario, undefined);
  } finally { removerContexto(contexto); }
});

test('parâmetros globais criam versões auditáveis e exigem permissão administrativa', () => {
  const contexto = criarContexto();
  try {
    contexto.autenticacao.criarCredencial('admin', 'senha-admin', PapelUsuario.ADMINISTRADOR);
    const admin = contexto.autenticacao.login('admin', 'senha-admin');
    contexto.autenticacao.criarCredencial('auditor', 'senha-auditor', PapelUsuario.AUDITOR, 'Auditor', admin.token);
    const auditor = contexto.autenticacao.login('auditor', 'senha-auditor');
    const parametros = new ServicoParametrosGlobais(contexto.repositorio, contexto.autenticacao);

    assert.equal(parametros.consultar(admin.token).coeficienteDepreciacao, 0.08);
    assert.throws(() => parametros.consultar(auditor.token), /permissão/);
    const primeiraVersao = parametros.atualizar(admin.token, { imposto: 'ICMS', aliquota: 0.18 }, admin.usuarioId);
    const segundaVersao = parametros.atualizar(admin.token, { coeficienteDepreciacao: 0.1 }, admin.usuarioId);

    assert.equal(segundaVersao.versao, primeiraVersao.versao + 1);
    assert.equal(segundaVersao.aliquotasImpostos.ICMS, 0.18);
    assert.equal(segundaVersao.coeficienteDepreciacao, 0.1);
    assert.deepEqual(parametros.listarHistorico(admin.token).map((versao) => versao.versao), [1, 2]);
    assert.throws(() => parametros.atualizar(auditor.token, { coeficienteDepreciacao: 0.2 }, auditor.usuarioId), /permissão/);
  } finally { removerContexto(contexto); }
});

test('persiste com escrita atômica sem arquivo temporário após sucesso', () => {
  const contexto = criarContexto();
  try {
    cadastrarOrganizacao(contexto.organizacao);
    const diretorio = join(contexto.raiz, 'dados');
    assert.equal(readdirSync(diretorio).some((arquivo) => arquivo.includes('.tmp-')), false);
    assert.equal(contexto.repositorio.listarEntidades('organizacoes').length, 1);
  } finally { removerContexto(contexto); }
});

test('histórico de comandos é persistido cifrado e pode ser lido pelo repositório', () => {
  const contexto = criarContexto();
  try {
    const comandos = ['org listar', 'relatorio status --status AGUARDANDO_TRIAGEM'];
    contexto.repositorio.salvarEntidade('historico-comandos', { id: 'cli', comandos });

    const arquivo = readFileSync(join(contexto.raiz, 'dados', 'historico-comandos.txt'), 'utf-8');
    assert.equal(arquivo.includes(comandos[0]), false);
    assert.equal(arquivo.includes(comandos[1]), false);
    assert.deepEqual(contexto.repositorio.carregarEntidade('historico-comandos', 'cli').comandos, comandos);
  } finally { removerContexto(contexto); }
});

test('falha de escrita não altera o arquivo final, remove temporário e registra aborto', () => {
  let gravacoesAteFalha = 0;
  const contexto = criarContexto({
    antesRenomear: () => {
      gravacoesAteFalha += 1;
      if (gravacoesAteFalha === 2) throw new Error('Falha simulada antes da renomeação.');
    },
  });
  try {
    assert.throws(() => cadastrarOrganizacao(contexto.organizacao), /Falha simulada/);
    assert.equal(contexto.repositorio.carregarEntidade('organizacoes', 'ORG-001'), null);
    assert.equal(readdirSync(join(contexto.raiz, 'dados')).some((arquivo) => arquivo.includes('.tmp-')), false);
    assert.equal(JournalTransacao.listar(contexto.repositorio).some((item) => item.resultado === 'ABORTADA'), true);
  } finally { removerContexto(contexto); }
});

test('recupera no início uma intenção de transação sem desfecho', () => {
  const contexto = criarContexto();
  try {
    const organizacao = {
      id: 'ORG-PENDENTE', razaoSocial: 'Organização Pendente', cnpj: '04.252.011/0001-10',
      inscricaoEstadual: 'ISENTO', enderecoCompleto: 'Rua Teste', telefone: '', email: '',
      dataCadastro: new Date(), ativo: true, contratoVigente: null,
    };
    new JournalTransacao('journal-intencao', new Date(), 'CRIAR', 'organizacoes', null, organizacao,
      'usuario-anonimo-1', contexto.repositorio, 'tx-pendente', 'INTENCAO').registrar();

    assert.equal(contexto.repositorio.carregarEntidade('organizacoes', 'ORG-PENDENTE'), null);
    assert.equal(JournalTransacao.recuperarPendentes(contexto.repositorio), 1);
    assert.equal(contexto.repositorio.carregarEntidade('organizacoes', 'ORG-PENDENTE').id, 'ORG-PENDENTE');
    assert.equal(JournalTransacao.recuperarPendentes(contexto.repositorio), 0);
  } finally { removerContexto(contexto); }
});

test('remove temporários órfãos no início sem alterar os arquivos definitivos', () => {
  const contexto = criarContexto();
  try {
    cadastrarOrganizacao(contexto.organizacao);
    const caminhoTemporario = join(contexto.raiz, 'dados', 'organizacoes.txt.tmp-orphan');
    writeFileSync(caminhoTemporario, 'temporário órfão');
    assert.equal(contexto.repositorio.limparTemporariosOrfaos(), 1);
    assert.equal(existsSync(caminhoTemporario), false);
    assert.equal(contexto.repositorio.listarEntidades('organizacoes').length, 1);
  } finally { removerContexto(contexto); }
});

test('rotaciona o journal ao ultrapassar 10 MB', () => {
  const contexto = criarContexto();
  try {
    const diretorio = join(contexto.raiz, 'dados');
    const arquivoAtual = join(diretorio, 'journal-transacoes.txt');
    // O conteúdo será rotacionado antes de ser lido, simulando um arquivo que já ultrapassou o limite.
    mkdirSync(diretorio, { recursive: true });
    writeFileSync(arquivoAtual, 'x'.repeat(10 * 1024 * 1024));
    JournalTransacao.criar('ROTACAO', 'equipamentos', null, { id: 'EQ-001' }, 'admin', contexto.repositorio).registrar();
    assert.equal(statSync(arquivoAtual).size > 0, true);
    assert.equal(readdirSync(diretorio).some((arquivo) => arquivo.startsWith('journal-transacoes-')), true);
  } finally { removerContexto(contexto); }
});

test('a recuperação de transações permanece idempotente depois de confirmada', () => {
  const contexto = criarContexto();
  try {
    cadastrarOrganizacao(contexto.organizacao);
    assert.equal(JournalTransacao.recuperarPendentes(contexto.repositorio), 0);
    assert.equal(contexto.repositorio.listarEntidades('organizacoes').length, 1);
  } finally { removerContexto(contexto); }
});
