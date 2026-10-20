import { Equipamento } from './Equipamento.js';
import { StatusLote } from '../types/StatusLote.js';
import { StatusRastreamento } from '../types/StatusRastreamento.js';

export class Lote {
  constructor(
    public id: string,
    public dataEntrada: Date,
    public organizacaoId: string,
    public notaFiscal: string,
    public transportadora: string,
    public equipamentos: Equipamento[],
    public statusProcessamento: StatusLote,
    public observacoes: string,
    public cancelado = false,
    public motivoCancelamento: string | null = null,
  ) {}

  adicionarEquipamento(equip: Equipamento): void {
    this.exigirAtivo();
    this.equipamentos.push(equip);
  }

  cancelar(motivo: string): void {
    if (!motivo.trim()) throw new Error('Informe o motivo do cancelamento do lote.');
    if (this.cancelado) throw new Error('O lote já está cancelado.');
    this.cancelado = true;
    this.motivoCancelamento = motivo.trim();
  }

  exigirAtivo(): void {
    if (this.cancelado) throw new Error('O lote está cancelado e não aceita novas operações.');
  }

  removerEquipamento(equipId: string): boolean {
    const indice = this.equipamentos.findIndex((equipamento) => equipamento.id === equipId);

    if (indice === -1) {
      return false;
    }

    throw new Error('Equipamentos vinculados não são removidos do lote; cancele o cadastro para preservar o histórico.');
  }

  calcularPesoTotal(): number {
    return this.equipamentos.reduce(
      (pesoTotal, equipamento) => pesoTotal + equipamento.pesoQuilogramas,
      0,
    );
  }

  gerarRelatorioTriagem(): string {
    const quantidadeTriada = this.equipamentos.filter(
      (equipamento) => equipamento.statusRastreamento !== StatusRastreamento.AGUARDANDO_TRIAGEM,
    ).length;

    return [
      `Lote: ${this.id}`,
      `Status: ${this.statusProcessamento}`,
      `Equipamentos: ${this.equipamentos.length}`,
      `Equipamentos triados: ${quantidadeTriada}`,
      `Peso total: ${this.calcularPesoTotal().toFixed(2)} kg`,
    ].join('\n');
  }
}
