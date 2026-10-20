import { randomBytes, scryptSync } from 'node:crypto';

import { CriptografiaArquivo } from '../infra/CriptografiaArquivo.js';
import { ConfiguracaoSistema } from './ConfiguracaoSistema.js';

export class ProvisionamentoInicial {
  constructor(
    private configuracao: ConfiguracaoSistema,
    private criptografia: CriptografiaArquivo,
  ) {}

  precisaProvisionar(): boolean {
    return !this.configuracao.existe();
  }

  provisionar(senhaPrimeiroAdministrador: string): string {
    if (!this.precisaProvisionar()) {
      throw new Error('O sistema já foi provisionado.');
    }

    if (!senhaPrimeiroAdministrador.trim()) {
      throw new Error('A senha do primeiro administrador é obrigatória.');
    }

    const chaveMestra = this.criptografia.gerarChave();
    const saltProtecao = randomBytes(16);
    const chaveProtecao = this.derivarChaveProtecao(senhaPrimeiroAdministrador, saltProtecao);

    this.configuracao.salvar({
      versao: 1,
      saltProtecao: saltProtecao.toString('base64'),
      chaveMestraProtegida: this.criptografia.cifrar(chaveMestra, chaveProtecao),
    });

    return chaveMestra;
  }

  obterChaveMestra(senhaAdministrador: string): string {
    const configuracao = this.configuracao.carregar();
    const saltProtecao = Buffer.from(configuracao.saltProtecao, 'base64');
    const chaveProtecao = this.derivarChaveProtecao(senhaAdministrador, saltProtecao);

    return this.criptografia.decifrar(configuracao.chaveMestraProtegida, chaveProtecao);
  }

  private derivarChaveProtecao(senha: string, salt: Buffer): string {
    return scryptSync(senha, salt, 32).toString('hex');
  }
}
