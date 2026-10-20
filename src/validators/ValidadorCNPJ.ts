import { Validador } from './Validador.js';

export class ValidadorCNPJ extends Validador {
  validar(cnpj: string): boolean {
    this.mensagemErro = '';

    const cnpjInformado = cnpj.trim();
    if (!/^[\d./-]+$/.test(cnpjInformado)) {
      this.mensagemErro = 'CNPJ deve conter apenas dígitos e os separadores . / -.';
      return false;
    }

    const digitos = cnpjInformado.replace(/\D/g, '');
    if (digitos.length !== 14) {
      this.mensagemErro = 'CNPJ deve possuir 14 dígitos.';
      return false;
    }

    if (/^(\d)\1{13}$/.test(digitos)) {
      this.mensagemErro = 'CNPJ não pode possuir todos os dígitos iguais.';
      return false;
    }

    const primeiroDigito = this.calcularDigitoVerificador(digitos.substring(0, 12));
    const segundoDigito = this.calcularDigitoVerificador(digitos.substring(0, 12) + primeiroDigito);

    if (digitos.substring(12) !== `${primeiroDigito}${segundoDigito}`) {
      this.mensagemErro = 'CNPJ possui dígitos verificadores inválidos.';
      return false;
    }

    return true;
  }

  private calcularDigitoVerificador(base: string): number {
    const pesos = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

    const soma = base
      .split('')
      .reduce((total, digito, indice) => total + Number(digito) * pesos[indice], 0);
    const resto = soma % 11;

    return resto < 2 ? 0 : 11 - resto;
  }
}
