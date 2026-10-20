export class Movimentacao {
  constructor(
    public readonly id: string,
    public readonly equipamentoId: string,
    public readonly dataHora: Date,
    public readonly origem: string,
    public readonly destino: string,
    public readonly responsavel: string,
    public readonly observacao: string,
    public readonly tipoEvento: 'MOVIMENTACAO' | 'STATUS' | 'ESTADO_FISICO' | 'CANCELAMENTO' | 'CORRECAO' | 'ESTORNO' = 'MOVIMENTACAO',
    public readonly movimentacaoReferenciadaId: string | null = null,
    public readonly destinoCorrigido: string | null = null,
  ) {}
}
