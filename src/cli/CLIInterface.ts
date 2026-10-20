import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface, Interface } from 'node:readline';

import { Equipamento } from '../domain/Equipamento.js';
import { AcaoProtegida, ServicoAutenticacao } from '../services/ServicoAutenticacao.js';
import { ServicoEquipamento } from '../services/ServicoEquipamento.js';
import { ServicoLote } from '../services/ServicoLote.js';
import { ServicoOrganizacao } from '../services/ServicoOrganizacao.js';
import { ServicoRelatorio } from '../services/ServicoRelatorio.js';
import { ServicoParametrosGlobais } from '../services/ServicoParametrosGlobais.js';
import { RepositorioArquivo } from '../infra/RepositorioArquivo.js';
import { Sessao } from '../session/Sessao.js';
import { EstadoFisico } from '../types/EstadoFisico.js';
import { PapelUsuario } from '../types/PapelUsuario.js';
import { StatusRastreamento } from '../types/StatusRastreamento.js';
import { StatusLote } from '../types/StatusLote.js';
import { TipoEquipamento } from '../types/TipoEquipamento.js';

type NivelMensagem = 'SUCESSO' | 'ERRO' | 'INFO';

export class CLIInterface {
  public sessaoAtual: Sessao | null = null;
  private interface: Interface | null = null;
  private readonly caminhoHistoricoLegado = join('data', 'historico-comandos.txt');
  private readonly comandosPublicos = ['ajuda', 'login', 'logout', 'menu', 'sair'];

  constructor(private autenticacao: ServicoAutenticacao, private organizacao: ServicoOrganizacao, private lote: ServicoLote, private equipamento: ServicoEquipamento, private relatorio: ServicoRelatorio, private parametrosGlobais?: ServicoParametrosGlobais, private repositorio?: RepositorioArquivo) {}

  iniciarLoop(): void { void this.executarLoop(); }

  processarComando(entrada: string): void {
    const [comando = '', acao = '', ...restante] = this.tokenizar(entrada);
    const opcoes = this.extrairOpcoes(restante);
    try {
      if (comando === 'login') {
        this.sessaoAtual = this.autenticacao.login(acao, this.obrigatoria(opcoes, 'senha'));
        this.exibir('SUCESSO', `Login efetuado para ${this.sessaoAtual.usuario}.`);
      } else if (comando === 'logout') {
        if (this.sessaoAtual) this.autenticacao.logout(this.sessaoAtual.token);
        this.sessaoAtual = null; this.exibir('SUCESSO', 'Sessão encerrada.');
      } else if (comando === 'menu') {
        this.exigirSessao(); this.exibirMenuPorPapel(this.sessaoAtual!.papel);
      } else if (comando === 'usuario' && acao === 'criar') {
        this.exigir('GERENCIAR_CREDENCIAIS');
        this.autenticacao.criarCredencial(this.obrigatoria(opcoes, 'usuario'), this.obrigatoria(opcoes, 'senha'), this.enumObrigatorio(PapelUsuario, opcoes.papel, 'papel'), opcoes.nome ?? opcoes.usuario ?? '', this.sessaoAtual!.token);
        this.exibir('SUCESSO', 'Credencial criada.');
      } else if (comando === 'usuario' && acao === 'listar') {
        this.exigir('GERENCIAR_CREDENCIAIS');
        this.exibir('INFO', JSON.stringify(this.autenticacao.listarCredenciais(this.sessaoAtual!.token), null, 2));
      } else if (comando === 'usuario' && acao === 'consultar') {
        this.exigir('GERENCIAR_CREDENCIAIS');
        this.exibir('INFO', JSON.stringify(this.autenticacao.buscarCredencial(opcoes.usuario ?? opcoes.id ?? '', this.sessaoAtual!.token), null, 2));
      } else if (comando === 'usuario' && acao === 'nome') {
        this.exigir('GERENCIAR_CREDENCIAIS'); this.autenticacao.alterarNomeExibicao(this.obrigatoria(opcoes, 'usuario'), this.obrigatoria(opcoes, 'novo'), this.sessaoAtual!.token);
        this.exibir('SUCESSO', 'Nome de exibição atualizado.');
      } else if (comando === 'usuario' && acao === 'papel') {
        this.exigir('GERENCIAR_CREDENCIAIS'); this.autenticacao.alterarPapel(this.obrigatoria(opcoes, 'usuario'), this.enumObrigatorio(PapelUsuario, opcoes.papel, 'papel'), this.sessaoAtual!.token);
        this.exibir('SUCESSO', 'Papel atualizado; as sessões anteriores do usuário foram encerradas.');
      } else if (comando === 'usuario' && acao === 'senha') {
        this.exigir('GERENCIAR_CREDENCIAIS'); this.autenticacao.redefinirSenha(this.obrigatoria(opcoes, 'usuario'), this.obrigatoria(opcoes, 'nova'), this.sessaoAtual!.token);
        this.exibir('SUCESSO', 'Senha redefinida; as sessões anteriores do usuário foram encerradas.');
      } else if (comando === 'usuario' && acao === 'desativar') {
        this.exigir('GERENCIAR_CREDENCIAIS'); this.autenticacao.desativarCredencial(this.obrigatoria(opcoes, 'usuario'), this.sessaoAtual!.token);
        this.exibir('SUCESSO', 'Conta desativada e dados de autenticação removidos.');
      } else if (comando === 'senha' && acao === 'alterar') {
        this.exigirSessao();
        const alterada = this.autenticacao.alterarSenha(this.sessaoAtual!.token, this.obrigatoria(opcoes, 'atual'), this.obrigatoria(opcoes, 'nova'));
        if (!alterada) throw new Error('Senha atual inválida ou nova senha ausente.');
        this.sessaoAtual = null;
        this.exibir('SUCESSO', 'Senha alterada. Entre novamente com a nova senha.');
      } else if (comando === 'parametros' && acao === 'consultar') {
        this.exigir('GERENCIAR_PARAMETROS_GLOBAIS'); this.exibir('INFO', JSON.stringify(this.exigirServicoParametros().consultar(this.sessaoAtual!.token), null, 2));
      } else if (comando === 'parametros' && acao === 'historico') {
        this.exigir('GERENCIAR_PARAMETROS_GLOBAIS'); this.exibir('INFO', JSON.stringify(this.exigirServicoParametros().listarHistorico(this.sessaoAtual!.token), null, 2));
      } else if (comando === 'parametros' && acao === 'atualizar') {
        this.exigir('GERENCIAR_PARAMETROS_GLOBAIS');
        this.exigirServicoParametros().atualizar(this.sessaoAtual!.token, { imposto: opcoes.imposto, aliquota: opcoes.aliquota === undefined ? undefined : this.numeroObrigatorio(opcoes, 'aliquota'), coeficienteDepreciacao: opcoes['coeficiente-depreciacao'] === undefined ? undefined : this.numeroObrigatorio(opcoes, 'coeficiente-depreciacao') }, this.sessaoAtual!.usuarioId || this.sessaoAtual!.usuario);
        this.exibir('SUCESSO', 'Nova versão dos parâmetros globais registrada no histórico.');
      } else if (comando === 'org' && acao === 'criar') {
        this.exigir('GERENCIAR_ORGANIZACOES');
        this.organizacao.cadastrarOrganizacao({ id: this.obrigatoria(opcoes, 'id'), razaoSocial: this.obrigatoria(opcoes, 'razao'), cnpj: this.obrigatoria(opcoes, 'cnpj'), inscricaoEstadual: opcoes.ie ?? '', enderecoCompleto: opcoes.endereco ?? '', telefone: opcoes.telefone ?? '', email: opcoes.email ?? '', contratoVigente: null });
        this.exibir('SUCESSO', 'Organização cadastrada.');
      } else if (comando === 'org' && acao === 'listar') {
        this.exigir('GERENCIAR_ORGANIZACOES'); this.exibir('INFO', JSON.stringify(this.organizacao.listarOrganizacoes(opcoes.todas === 'true'), null, 2));
      } else if (comando === 'org' && acao === 'consultar') {
        this.exigir('GERENCIAR_ORGANIZACOES'); this.exibir('INFO', JSON.stringify(this.organizacao.buscarOrganizacao(this.obrigatoria(opcoes, 'id')), null, 2));
      } else if (comando === 'org' && acao === 'atualizar') {
        this.exigir('GERENCIAR_ORGANIZACOES'); this.organizacao.atualizarOrganizacao(this.obrigatoria(opcoes, 'id'), { razaoSocial: this.obrigatoria(opcoes, 'razao'), cnpj: this.obrigatoria(opcoes, 'cnpj'), inscricaoEstadual: opcoes.ie, enderecoCompleto: opcoes.endereco, telefone: opcoes.telefone, email: opcoes.email });
        this.exibir('SUCESSO', 'Organização atualizada; os dados anteriores permanecem no journal.');
      } else if (comando === 'org' && acao === 'renovar-contrato') {
        this.exigir('GERENCIAR_CONTRATOS'); this.organizacao.renovarContrato(this.obrigatoria(opcoes, 'id'), this.dataObrigatoria(opcoes, 'vencimento'));
        this.exibir('SUCESSO', 'Contrato renovado.');
      } else if (comando === 'contrato' && acao === 'criar') {
        this.exigir('GERENCIAR_CONTRATOS'); this.organizacao.cadastrarContrato(this.obrigatoria(opcoes, 'org'), { id: this.obrigatoria(opcoes, 'id'), dataAssinatura: this.dataObrigatoria(opcoes, 'assinatura'), dataVencimento: this.dataObrigatoria(opcoes, 'vencimento'), clausulas: (opcoes.clausulas ?? '').split('|').map((item) => item.trim()).filter(Boolean), valorMensal: this.numeroObrigatorio(opcoes, 'valor'), renovacaoAutomatica: opcoes.renovacao === 'true' });
        this.exibir('SUCESSO', 'Contrato cadastrado.');
      } else if (comando === 'contrato' && acao === 'listar') {
        this.exigir('GERENCIAR_CONTRATOS'); this.exibir('INFO', JSON.stringify(this.organizacao.listarContratos(this.obrigatoria(opcoes, 'org')), null, 2));
      } else if (comando === 'contrato' && acao === 'atualizar') {
        this.exigir('GERENCIAR_CONTRATOS'); this.organizacao.atualizarContrato(this.obrigatoria(opcoes, 'org'), this.obrigatoria(opcoes, 'id'), { clausulas: opcoes.clausulas?.split('|').map((item) => item.trim()).filter(Boolean), valorMensal: opcoes.valor === undefined ? undefined : this.numeroObrigatorio(opcoes, 'valor'), renovacaoAutomatica: opcoes.renovacao === undefined ? undefined : opcoes.renovacao === 'true' });
        this.exibir('SUCESSO', 'Contrato atualizado; o estado anterior permanece no journal.');
      } else if (comando === 'contrato' && acao === 'cancelar') {
        this.exigir('GERENCIAR_CONTRATOS'); this.organizacao.cancelarContrato(this.obrigatoria(opcoes, 'org'), this.obrigatoria(opcoes, 'id'));
        this.exibir('SUCESSO', 'Contrato encerrado; dados históricos preservados.');
      } else if (comando === 'org' && acao === 'desativar') {
        this.exigir('GERENCIAR_ORGANIZACOES'); this.organizacao.desativarOrganizacao(this.obrigatoria(opcoes, 'id'), this.obrigatoria(opcoes, 'motivo'));
        this.exibir('SUCESSO', 'Organização desativada; vínculos históricos preservados.');
      } else if (comando === 'org' && acao === 'encerrar-contrato') {
        this.exigir('GERENCIAR_CONTRATOS'); this.organizacao.encerrarContrato(this.obrigatoria(opcoes, 'id'));
        this.exibir('SUCESSO', 'Contrato encerrado; dados históricos preservados.');
      } else if (comando === 'lote' && acao === 'criar') {
        this.exigir('GERENCIAR_LOTES');
        this.lote.criarLote({ id: this.obrigatoria(opcoes, 'id'), dataEntrada: opcoes.data ? this.dataObrigatoria(opcoes, 'data') : new Date(), organizacaoId: this.obrigatoria(opcoes, 'org'), notaFiscal: this.obrigatoria(opcoes, 'nf'), transportadora: this.obrigatoria(opcoes, 'transp'), observacoes: opcoes.obs ?? '' });
        this.exibir('SUCESSO', 'Lote criado.');
      } else if (comando === 'lote' && acao === 'consultar') {
        this.exigir('GERENCIAR_LOTES'); this.exibir('INFO', JSON.stringify(this.lote.consultarLote(this.obrigatoria(opcoes, 'id')), null, 2));
      } else if (comando === 'lote' && acao === 'listar') {
        this.exigir('GERENCIAR_LOTES');
        const inicio = opcoes.inicio ? this.dataObrigatoria(opcoes, 'inicio') : undefined;
        const fim = opcoes.fim ? this.dataObrigatoria(opcoes, 'fim') : undefined;
        if (fim) fim.setHours(23, 59, 59, 999);
        this.exibir('INFO', JSON.stringify(this.lote.listarLotes({ organizacaoId: opcoes.org, dataInicio: inicio, dataFim: fim, status: opcoes.status ? this.enumObrigatorio(StatusLote, opcoes.status, 'status') : undefined, incluirCancelados: opcoes.todos === 'true' }), null, 2));
      } else if (comando === 'lote' && acao === 'atualizar') {
        this.exigir('GERENCIAR_LOTES'); this.lote.atualizarLote(this.obrigatoria(opcoes, 'id'), { dataEntrada: opcoes.data ? this.dataObrigatoria(opcoes, 'data') : undefined, notaFiscal: opcoes.nf, transportadora: opcoes.transp, observacoes: opcoes.obs });
        this.exibir('SUCESSO', 'Lote atualizado; a organização vinculada e os registros anteriores foram preservados.');
      } else if (comando === 'lote' && acao === 'triagem') {
        this.exigir('TRIAR_EQUIPAMENTOS'); this.lote.processarTriagem(this.obrigatoria(opcoes, 'id')); this.exibir('SUCESSO', 'Triagem concluída.');
      } else if (comando === 'lote' && acao === 'cancelar') {
        this.exigir('GERENCIAR_LOTES'); this.lote.cancelarLote(this.obrigatoria(opcoes, 'id'), this.obrigatoria(opcoes, 'motivo'));
        this.exibir('SUCESSO', 'Lote cancelado; equipamentos e histórico preservados.');
      } else if (comando === 'equip' && acao === 'criar') {
        this.exigir('GERENCIAR_EQUIPAMENTOS');
        const tipo = this.enumObrigatorio(TipoEquipamento, opcoes.tipo, 'tipo');
        const novo = new Equipamento(this.obrigatoria(opcoes, 'id'), this.equipamento.gerarCodigoBarras(tipo, Date.now()), tipo, this.obrigatoria(opcoes, 'marca'), this.obrigatoria(opcoes, 'modelo'), this.numeroObrigatorio(opcoes, 'ano'), this.enumObrigatorio(EstadoFisico, opcoes.estado, 'estado'), this.numeroObrigatorio(opcoes, 'peso'), this.obrigatoria(opcoes, 'lote'), 0, StatusRastreamento.AGUARDANDO_TRIAGEM, []);
        this.lote.adicionarEquipamentoLote(novo.loteId, novo); this.exibir('SUCESSO', `Equipamento cadastrado com código ${novo.codigoBarrasInterno}.`);
      } else if (comando === 'equip' && acao === 'consultar') {
        this.exigir('GERENCIAR_EQUIPAMENTOS'); this.exibir('INFO', JSON.stringify(this.equipamento.consultarEquipamento(opcoes.id ?? opcoes.codigo ?? ''), null, 2));
      } else if (comando === 'equip' && acao === 'listar') {
        this.exigir('GERENCIAR_EQUIPAMENTOS'); this.exibir('INFO', JSON.stringify(this.equipamento.listarEquipamentos({ loteId: opcoes.lote, status: opcoes.status ? this.enumObrigatorio(StatusRastreamento, opcoes.status, 'status') : undefined, incluirCancelados: opcoes.todos === 'true' }), null, 2));
      } else if (comando === 'equip' && acao === 'atualizar') {
        this.exigir('GERENCIAR_EQUIPAMENTOS'); this.equipamento.atualizarEquipamento(this.obrigatoria(opcoes, 'id'), { marca: opcoes.marca, modelo: opcoes.modelo, anoFabricacao: opcoes.ano === undefined ? undefined : this.numeroObrigatorio(opcoes, 'ano'), pesoQuilogramas: opcoes.peso === undefined ? undefined : this.numeroObrigatorio(opcoes, 'peso') });
        this.exibir('SUCESSO', 'Cadastro do equipamento atualizado antes da triagem.');
      } else if (comando === 'equip' && acao === 'status') {
        this.exigir('GERENCIAR_EQUIPAMENTOS'); this.equipamento.atualizarStatusRastreamento(this.obrigatoria(opcoes, 'id'), this.enumObrigatorio(StatusRastreamento, opcoes.status, 'status'), this.sessaoAtual!.usuarioId || this.sessaoAtual!.usuario);
        this.exibir('SUCESSO', 'Status atualizado e registrado no histórico do equipamento.');
      } else if (comando === 'equip' && acao === 'mover') {
        this.exigir('GERENCIAR_EQUIPAMENTOS'); this.equipamento.registrarMovimentacao(this.obrigatoria(opcoes, 'id'), this.obrigatoria(opcoes, 'destino'), this.sessaoAtual!.usuarioId || this.sessaoAtual!.usuario); this.exibir('SUCESSO', 'Movimentação registrada.');
      } else if (comando === 'equip' && acao === 'corrigir-movimentacao') {
        this.exigir('GERENCIAR_EQUIPAMENTOS'); this.equipamento.corrigirMovimentacao(this.obrigatoria(opcoes, 'id'), this.obrigatoria(opcoes, 'mov'), this.obrigatoria(opcoes, 'destino'), this.sessaoAtual!.usuarioId || this.sessaoAtual!.usuario, this.obrigatoria(opcoes, 'justificativa'));
        this.exibir('SUCESSO', 'Correção registrada como novo evento; a movimentação original foi mantida.');
      } else if (comando === 'equip' && acao === 'estornar-movimentacao') {
        this.exigir('GERENCIAR_EQUIPAMENTOS'); this.equipamento.estornarMovimentacao(this.obrigatoria(opcoes, 'id'), this.obrigatoria(opcoes, 'mov'), this.sessaoAtual!.usuarioId || this.sessaoAtual!.usuario, this.obrigatoria(opcoes, 'justificativa'));
        this.exibir('SUCESSO', 'Estorno registrado como novo evento; a movimentação original foi mantida.');
      } else if (comando === 'equip' && acao === 'cancelar') {
        this.exigir('GERENCIAR_EQUIPAMENTOS'); this.equipamento.cancelarEquipamento(this.obrigatoria(opcoes, 'id'), this.obrigatoria(opcoes, 'motivo'), this.sessaoAtual!.usuarioId || this.sessaoAtual!.usuario);
        this.exibir('SUCESSO', 'Cadastro cancelado; equipamento e histórico preservados.');
      } else if (comando === 'equip' && acao === 'estado') {
        this.exigir('GERENCIAR_EQUIPAMENTOS'); this.equipamento.atualizarEstadoFisico(this.obrigatoria(opcoes, 'id'), this.enumObrigatorio(EstadoFisico, opcoes.estado, 'estado'), opcoes.justificativa ?? '', this.sessaoAtual!.usuarioId || this.sessaoAtual!.usuario); this.exibir('SUCESSO', 'Estado físico atualizado e registrado no histórico.');
      } else if (comando === 'rastrear') {
        this.exigir('CONSULTAR_HISTORICOS'); this.exibir('INFO', JSON.stringify(this.equipamento.rastrearEquipamento(acao), null, 2));
      } else if (comando === 'relatorio' && acao === 'status') {
        this.exigir('GERAR_RELATORIOS'); this.exibir('INFO', this.relatorio.gerarRelatorioPorStatus(this.enumObrigatorio(StatusRastreamento, opcoes.status, 'status')));
      } else if (comando === 'relatorio' && acao === 'organizacao') {
        this.exigir('GERAR_RELATORIOS'); this.exibir('INFO', this.relatorio.gerarRelatorioPorOrganizacao(this.obrigatoria(opcoes, 'org'), this.periodoObrigatorio(opcoes)));
      } else if (comando === 'relatorio' && acao === 'financeiro') {
        this.exigir('GERAR_RELATORIOS'); this.exibir('INFO', this.relatorio.gerarRelatorioFinanceiro(this.periodoObrigatorio(opcoes)));
      } else if (comando === 'relatorio' && acao === 'auditoria') {
        this.exigir('GERAR_RELATORIOS'); this.exibir('INFO', this.relatorio.gerarRelatorioAuditoria(this.periodoObrigatorio(opcoes)));
      } else if (comando === 'ajuda') {
        this.exibirAjuda();
      } else { throw new Error('Comando inválido. Use ajuda.'); }
    } catch (erro) { this.exibir('ERRO', erro instanceof Error ? erro.message : 'Falha na operação.'); }
  }

  exibirMenuPorPapel(papel: PapelUsuario): void {
    const menus: Record<PapelUsuario, string[]> = {
      ADMINISTRADOR: ['usuario criar', 'usuario listar', 'usuario consultar', 'usuario nome', 'usuario papel', 'usuario senha', 'usuario desativar', 'senha alterar', 'parametros consultar/historico/atualizar', 'org criar/listar/consultar/atualizar/desativar', 'contrato criar/listar/atualizar/cancelar/renovar/encerrar', 'lote criar/listar/consultar/atualizar/cancelar/triagem', 'equip criar/listar/consultar/atualizar/status/cancelar/mover/corrigir-movimentacao/estornar-movimentacao/estado', 'rastrear', 'relatorio status/organizacao/financeiro/auditoria'],
      OPERADOR_CADASTRO: ['senha alterar', 'org criar/listar/consultar/atualizar/desativar', 'contrato criar/listar/atualizar/cancelar/renovar/encerrar'],
      GESTOR_ALMOXARIFADO: ['senha alterar', 'lote criar/listar/consultar/atualizar/cancelar/triagem', 'equip criar/listar/consultar/atualizar/status/cancelar/mover/corrigir-movimentacao/estornar-movimentacao/estado'],
      AUDITOR: ['rastrear', 'relatorio status/organizacao/financeiro/auditoria'],
    };
    this.exibir('INFO', `Opções: ${menus[papel].join(' | ')}`);
  }

  private async executarLoop(): Promise<void> {
    this.interface = createInterface({ input: process.stdin, output: process.stdout, completer: (linha: string) => this.completar(linha) });
    this.carregarHistorico(); this.exibir('INFO', 'Greencode iniciado. Use ajuda.'); this.interface.setPrompt('greencode> '); this.interface.prompt();
    this.interface.on('line', (linha: string) => { if (linha.trim() === 'sair') { this.interface?.close(); return; } if (linha.trim()) this.salvarHistorico(linha.trim()); this.processarComando(linha.trim()); this.interface?.prompt(); });
  }

  private completar(linha: string): [string[], string] {
    const candidatos = this.comandosDisponiveis(); const sugestoes = candidatos.filter((comando) => comando.startsWith(linha.trimStart()));
    return [sugestoes.length ? sugestoes : candidatos, linha];
  }

  private comandosDisponiveis(): string[] {
    if (!this.sessaoAtual) return this.comandosPublicos;
    const porPapel: Record<PapelUsuario, string[]> = {
      ADMINISTRADOR: ['usuario criar', 'usuario listar', 'usuario consultar', 'usuario nome', 'usuario papel', 'usuario senha', 'usuario desativar', 'senha alterar', 'parametros consultar', 'parametros historico', 'parametros atualizar', 'org criar', 'org listar', 'org consultar', 'org atualizar', 'org desativar', 'contrato criar', 'contrato listar', 'contrato atualizar', 'contrato cancelar', 'org renovar-contrato', 'org encerrar-contrato', 'lote criar', 'lote listar', 'lote consultar', 'lote atualizar', 'lote cancelar', 'lote triagem', 'equip criar', 'equip listar', 'equip consultar', 'equip atualizar', 'equip status', 'equip cancelar', 'equip mover', 'equip corrigir-movimentacao', 'equip estornar-movimentacao', 'equip estado', 'rastrear', 'relatorio status', 'relatorio organizacao', 'relatorio financeiro', 'relatorio auditoria'],
      OPERADOR_CADASTRO: ['senha alterar', 'org criar', 'org listar', 'org consultar', 'org atualizar', 'org desativar', 'contrato criar', 'contrato listar', 'contrato atualizar', 'contrato cancelar', 'org renovar-contrato', 'org encerrar-contrato'],
      GESTOR_ALMOXARIFADO: ['senha alterar', 'lote criar', 'lote listar', 'lote consultar', 'lote atualizar', 'lote cancelar', 'lote triagem', 'equip criar', 'equip listar', 'equip consultar', 'equip atualizar', 'equip status', 'equip cancelar', 'equip mover', 'equip corrigir-movimentacao', 'equip estornar-movimentacao', 'equip estado'],
      AUDITOR: ['rastrear', 'relatorio status', 'relatorio organizacao', 'relatorio financeiro', 'relatorio auditoria'],
    };
    return [...this.comandosPublicos, ...porPapel[this.sessaoAtual.papel]];
  }

  private exibirAjuda(): void {
    this.exibir('INFO', [
      'login USUARIO --senha SENHA', 'usuario criar --usuario LOGIN --nome "NOME" --senha SENHA --papel PAPEL', 'usuario listar', 'usuario consultar --usuario LOGIN | --id ID', 'usuario nome --usuario LOGIN --novo "NOME"', 'usuario papel --usuario LOGIN --papel PAPEL', 'usuario senha --usuario LOGIN --nova SENHA', 'usuario desativar --usuario LOGIN', 'senha alterar --atual SENHA --nova SENHA',
      'parametros consultar', 'parametros historico', 'parametros atualizar [--imposto ICMS --aliquota 0.18] [--coeficiente-depreciacao 0.08]',
      'org criar --id ID --razao "RAZÃO" --cnpj CNPJ [--ie IE --endereco "ENDEREÇO" --telefone TEL --email EMAIL]', 'org listar [--todas true]', 'org consultar --id ORG', 'org atualizar --id ORG --razao "RAZÃO" --cnpj CNPJ [--ie IE --endereco "ENDEREÇO" --telefone TEL --email EMAIL]', 'org desativar --id ORG --motivo "MOTIVO"', 'org renovar-contrato --id ORG --vencimento AAAA-MM-DD', 'org encerrar-contrato --id ORG',
      'contrato criar --org ORG --id CONTRATO --assinatura AAAA-MM-DD --vencimento AAAA-MM-DD --valor VALOR [--clausulas "A|B" --renovacao true]', 'contrato listar --org ORG', 'contrato atualizar --org ORG --id CONTRATO [--valor VALOR --clausulas "A|B" --renovacao true|false]', 'contrato cancelar --org ORG --id CONTRATO',
      'lote criar --id ID --org ORG --nf NF --transp TRANSPORTADORA [--data AAAA-MM-DD --obs "TEXTO"]', 'lote listar [--org ORG --inicio AAAA-MM-DD --fim AAAA-MM-DD --status STATUS --todos true]', 'lote consultar --id LOTE', 'lote atualizar --id LOTE [--data AAAA-MM-DD --nf NF --transp TRANSPORTADORA --obs "TEXTO"]', 'lote triagem --id LOTE', 'lote cancelar --id LOTE --motivo "MOTIVO"',
      'equip criar --id ID --lote LOTE --tipo TIPO --marca MARCA --modelo MODELO --ano ANO --estado ESTADO --peso KG', 'equip listar [--lote LOTE --status STATUS --todos true]', 'equip consultar --id ID | --codigo BARRAS', 'equip atualizar --id ID [--marca MARCA --modelo MODELO --ano ANO --peso KG]', 'equip status --id ID --status STATUS', 'equip mover --id EQUIPAMENTO --destino DESTINO', 'equip corrigir-movimentacao --id EQ --mov ID_MOV --destino NOVO --justificativa TEXTO', 'equip estornar-movimentacao --id EQ --mov ID_MOV --justificativa TEXTO', 'equip estado --id EQUIPAMENTO --estado ESTADO [--justificativa "TEXTO"]', 'equip cancelar --id EQUIPAMENTO --motivo "MOTIVO"',
      'rastrear EQUIPAMENTO', 'relatorio status --status STATUS | relatorio organizacao --org ORG --inicio AAAA-MM-DD --fim AAAA-MM-DD | relatorio financeiro --inicio AAAA-MM-DD --fim AAAA-MM-DD | relatorio auditoria --inicio AAAA-MM-DD --fim AAAA-MM-DD',
      `Papéis: ${Object.values(PapelUsuario).join(', ')}`, `Estados: ${Object.values(EstadoFisico).join(', ')}`,
    ].join('\n'));
  }

  private exigir(acao: AcaoProtegida): void { this.exigirSessao(); if (!this.autenticacao.possuiPermissao(this.sessaoAtual!.token, acao)) throw new Error('Sessão inválida ou usuário sem permissão para esta operação.'); }
  private exigirServicoParametros(): ServicoParametrosGlobais { if (!this.parametrosGlobais) throw new Error('Serviço de parâmetros globais indisponível.'); return this.parametrosGlobais; }
  private exigirSessao(): void { if (!this.sessaoAtual || !this.autenticacao.validarToken(this.sessaoAtual.token)) { this.sessaoAtual = null; throw new Error('Faça login novamente.'); } }
  private obrigatoria(opcoes: Record<string, string>, nome: string): string { const valor = opcoes[nome]?.trim(); if (!valor) throw new Error(`O argumento --${nome} é obrigatório.`); return valor; }
  private numeroObrigatorio(opcoes: Record<string, string>, nome: string): number { const valor = Number(this.obrigatoria(opcoes, nome)); if (!Number.isFinite(valor)) throw new Error(`O argumento --${nome} deve ser numérico.`); return valor; }
  private dataObrigatoria(opcoes: Record<string, string>, nome: string): Date { const valor = this.obrigatoria(opcoes, nome); const data = new Date(`${valor}T00:00:00`); if (Number.isNaN(data.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new Error(`O argumento --${nome} deve usar o formato AAAA-MM-DD.`); return data; }
  private enumObrigatorio<T extends Record<string, string>>(enumeracao: T, valor: string | undefined, nome: string): T[keyof T] { const valorObrigatorio = this.obrigatoria({ [nome]: valor ?? '' }, nome); if (!Object.values(enumeracao).includes(valorObrigatorio)) throw new Error(`Valor inválido para --${nome}. Use: ${Object.values(enumeracao).join(', ')}.`); return valorObrigatorio as T[keyof T]; }
  private exibir(nivel: NivelMensagem, mensagem: string): void { console.log(`[${nivel}] ${mensagem}`); }
  private tokenizar(texto: string): string[] { return texto.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((item) => item.replace(/^"|"$/g, '')) ?? []; }
  private extrairOpcoes(tokens: string[]): Record<string, string> { const opcoes: Record<string, string> = {}; for (let indice = 0; indice < tokens.length; indice += 2) if (tokens[indice]?.startsWith('--')) opcoes[tokens[indice].slice(2)] = tokens[indice + 1] ?? ''; return opcoes; }
  private carregarHistorico(): void {
    if (!this.interface) return;
    const registro = this.repositorio?.carregarEntidade('historico-comandos', 'cli');
    let comandos: string[] = (registro?.comandos ?? []).filter((comando: string) => this.comandoSeguroParaHistorico(comando));
    if (existsSync(this.caminhoHistoricoLegado)) {
      const antigos = readFileSync(this.caminhoHistoricoLegado, 'utf-8').split(/\r?\n/).filter((comando) => this.comandoSeguroParaHistorico(comando));
      comandos = [...comandos, ...antigos].slice(-500);
      if (this.repositorio) {
        this.repositorio.salvarEntidade('historico-comandos', { id: 'cli', comandos });
        unlinkSync(this.caminhoHistoricoLegado);
      }
    }
    (this.interface as Interface & { history: string[] }).history = comandos.slice(-500).reverse();
  }
  private salvarHistorico(comando: string): void {
    if (!this.repositorio || !this.comandoSeguroParaHistorico(comando)) return;
    const registro = this.repositorio.carregarEntidade('historico-comandos', 'cli');
    const comandos = [...(registro?.comandos ?? []), comando.trim()].slice(-500);
    this.repositorio.salvarEntidade('historico-comandos', { id: 'cli', comandos });
  }

  private comandoSeguroParaHistorico(comando: string): boolean {
    const normalizado = comando.trim();
    if (!normalizado) return false;
    if (/^(login|usuario\s+(criar|senha)|senha\s+alterar)\b/i.test(normalizado)) return false;
    return !/(?:^|\s)--(?:senha|password|nova|atual)(?:\s|$)/i.test(normalizado);
  }

  private periodoObrigatorio(opcoes: Record<string, string>): { inicio: Date; fim: Date } {
    const inicio = this.dataObrigatoria(opcoes, 'inicio');
    const fim = this.dataObrigatoria(opcoes, 'fim');
    fim.setHours(23, 59, 59, 999);
    if (inicio > fim) throw new Error('A data inicial não pode ser posterior à data final.');
    return { inicio, fim };
  }
}
