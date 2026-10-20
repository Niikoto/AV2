export class Contrato {
  public historicoRenovacoes: Array<{ dataVencimentoAnterior: Date; dataVencimentoNovo: Date; registradoEm: Date }>;

  constructor(
    public id: string,
    public organizacaoId: string,
    public dataAssinatura: Date,
    public dataVencimento: Date,
    public clausulas: string[],
    public valorMensal: number,
    public renovacaoAutomatica: boolean,
    public encerradoEm: Date | null = null,
    historicoRenovacoes: Array<{ dataVencimentoAnterior: Date; dataVencimentoNovo: Date; registradoEm: Date }> = [],
  ) {
    this.historicoRenovacoes = historicoRenovacoes;
  }

  estaVigente(): boolean {
    return !this.encerradoEm && this.dataVencimento >= new Date();
  }

  renovar(novoVencimento: Date): void {
    if (this.encerradoEm) throw new Error('Não é possível renovar um contrato encerrado.');
    if (!(novoVencimento instanceof Date) || Number.isNaN(novoVencimento.getTime())) {
      throw new Error('A data de vencimento do contrato é inválida.');
    }
    if (novoVencimento <= this.dataVencimento) {
      throw new Error('A nova data de vencimento deve ser posterior à vigência atual.');
    }
    this.historicoRenovacoes.push({ dataVencimentoAnterior: this.dataVencimento, dataVencimentoNovo: novoVencimento, registradoEm: new Date() });
    this.dataVencimento = novoVencimento;
  }

  encerrar(dataEncerramento = new Date()): void {
    if (this.encerradoEm) throw new Error('O contrato já está encerrado.');
    this.encerradoEm = dataEncerramento;
  }
}
