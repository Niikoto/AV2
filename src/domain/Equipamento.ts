import { Movimentacao } from './Movimentacao.js';
import { EstadoFisico } from '../types/EstadoFisico.js';
import { StatusRastreamento } from '../types/StatusRastreamento.js';
import { TipoEquipamento } from '../types/TipoEquipamento.js';
import { randomUUID } from 'node:crypto';

export class Equipamento {
  constructor(
    public id: string,
    public codigoBarrasInterno: string,
    public tipo: TipoEquipamento,
    public marca: string,
    public modelo: string,
    public anoFabricacao: number,
    public estadoFisico: EstadoFisico,
    public pesoQuilogramas: number,
    public loteId: string,
    public posicaoNoLote: number,
    public statusRastreamento: StatusRastreamento,
    public historicoMovimentacao: Movimentacao[],
    public cancelado = false,
    public motivoCancelamento: string | null = null,
    public dataCadastro: Date | null = new Date(),
  ) {}

  atualizarStatus(novoStatus: StatusRastreamento, justificativa: string): void {
    void justificativa;
    this.exigirAtivo();
    this.statusRastreamento = novoStatus;
  }

  cancelar(motivo: string): void {
    if (!motivo.trim()) throw new Error('Informe o motivo do cancelamento do equipamento.');
    if (this.cancelado) throw new Error('O equipamento já está cancelado.');
    this.cancelado = true;
    this.motivoCancelamento = motivo.trim();
  }

  exigirAtivo(): void {
    if (this.cancelado) throw new Error('O equipamento está cancelado e não aceita novas operações.');
  }

  registrarMovimentacao(destino: string, responsavel: string, tipoEvento: 'MOVIMENTACAO' | 'STATUS' | 'ESTADO_FISICO' | 'CANCELAMENTO' | 'CORRECAO' | 'ESTORNO' = 'MOVIMENTACAO', observacao = `Movimentação registrada para ${this.id}`, movimentacaoReferenciadaId: string | null = null, destinoCorrigido: string | null = null, origemEvento?: string): void {
    this.exigirAtivo();
    const mov = new Movimentacao(
      randomUUID(),
      this.id,
      new Date(),
      origemEvento ?? [...this.historicoMovimentacao].reverse().find((evento) => evento.tipoEvento === 'MOVIMENTACAO' || evento.tipoEvento === 'ESTORNO')?.destino ?? 'RECEBIMENTO',
      destino,
      responsavel,
      observacao,
      tipoEvento,
      movimentacaoReferenciadaId,
      destinoCorrigido,
    );

    this.historicoMovimentacao.push(mov);
  }

  calcularDepreciacao(coeficienteDepreciacao = 0.08): number {
    if (!Number.isFinite(coeficienteDepreciacao) || coeficienteDepreciacao < 0 || coeficienteDepreciacao > 1) {
      throw new Error('O coeficiente de depreciação deve estar entre 0 e 1.');
    }
    const anos = Math.max(0, new Date().getFullYear() - this.anoFabricacao);
    const valor = this.pesoQuilogramas * anos * coeficienteDepreciacao;

    return Number(valor.toFixed(2));
  }
}
