export abstract class Validador {
  protected mensagemErro = '';

  abstract validar(objeto: any): boolean;

  obterMensagemErro(): string {
    return this.mensagemErro;
  }
}
