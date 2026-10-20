import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { join } from 'node:path';

import { CLIInterface } from './cli/CLIInterface.js';
import { ConfiguracaoSistema } from './config/ConfiguracaoSistema.js';
import { ProvisionamentoInicial } from './config/ProvisionamentoInicial.js';
import { CriptografiaArquivo } from './infra/CriptografiaArquivo.js';
import { JournalTransacao } from './infra/JournalTransacao.js';
import { RepositorioArquivo } from './infra/RepositorioArquivo.js';
import { ServicoAutenticacao } from './services/ServicoAutenticacao.js';
import { ServicoEquipamento } from './services/ServicoEquipamento.js';
import { ServicoLote } from './services/ServicoLote.js';
import { ServicoOrganizacao } from './services/ServicoOrganizacao.js';
import { ServicoRelatorio } from './services/ServicoRelatorio.js';
import { ServicoParametrosGlobais } from './services/ServicoParametrosGlobais.js';
import { PapelUsuario } from './types/PapelUsuario.js';
import { ValidadorCNPJ } from './validators/ValidadorCNPJ.js';
import { ValidadorDataEntrada } from './validators/ValidadorDataEntrada.js';

const entrada = createInterface({ input: stdin, output: stdout });
const criptografia = new CriptografiaArquivo();
const configuracao = new ConfiguracaoSistema(join('data', 'configuracao-mestre.json'));
const provisionamento = new ProvisionamentoInicial(configuracao, criptografia);
const primeiroProvisionamento = provisionamento.precisaProvisionar();
const senhaDesbloqueio = await entrada.question(
  primeiroProvisionamento
    ? 'Provisionamento inicial. Defina a senha do primeiro administrador: '
    : 'Senha de desbloqueio do sistema: ',
);
const chaveMestra = primeiroProvisionamento
  ? provisionamento.provisionar(senhaDesbloqueio)
  : provisionamento.obterChaveMestra(senhaDesbloqueio);
const repositorio = new RepositorioArquivo('data', criptografia, chaveMestra);
repositorio.limparTemporariosOrfaos();
const transacoesRecuperadas = JournalTransacao.recuperarPendentes(repositorio);
if (transacoesRecuperadas > 0) {
  console.log(`[INFO] ${transacoesRecuperadas} transação(ões) pendente(s) recuperada(s).`);
}
const autenticacao = new ServicoAutenticacao(repositorio);

if (primeiroProvisionamento) {
  autenticacao.criarCredencial('admin', senhaDesbloqueio, PapelUsuario.ADMINISTRADOR);
  console.log('[SUCESSO] Administrador inicial criado com usuário admin.');
}

entrada.close();
new CLIInterface(
  autenticacao,
  new ServicoOrganizacao(repositorio, new ValidadorCNPJ()),
  new ServicoLote(repositorio, new ValidadorDataEntrada()),
  new ServicoEquipamento(repositorio),
  new ServicoRelatorio(repositorio),
  new ServicoParametrosGlobais(repositorio, autenticacao),
  repositorio,
).iniciarLoop();
