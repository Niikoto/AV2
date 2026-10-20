import { Validador } from './Validador.js';

export class ValidadorDataEntrada extends Validador {
  validar(data: Date): boolean {
    this.mensagemErro = '';

    if (!(data instanceof Date) || Number.isNaN(data.getTime())) {
      this.mensagemErro = 'Data de entrada inválida.';
      return false;
    }

    const dataEntrada = new Date(data);
    dataEntrada.setHours(0, 0, 0, 0);

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const limitePassado = new Date(hoje);
    limitePassado.setDate(limitePassado.getDate() - 90);

    if (dataEntrada > hoje) {
      this.mensagemErro = 'Data de entrada não pode ser futura.';
      return false;
    }

    if (dataEntrada < limitePassado) {
      this.mensagemErro = 'Data de entrada não pode ser anterior a 90 dias.';
      return false;
    }

    return true;
  }
}
