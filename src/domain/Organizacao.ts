import { Contrato } from './Contrato.js';

export class Organizacao {
  constructor(
    public id: string,
    public razaoSocial: string,
    public cnpj: string,
    public inscricaoEstadual: string,
    public enderecoCompleto: string,
    public telefone: string,
    public email: string,
    public dataCadastro: Date,
    public ativo: boolean,
    public contratoVigente: Contrato | null,
    public motivoDesativacao: string | null = null,
    public contratos: Contrato[] = contratoVigente ? [contratoVigente] : [],
  ) {}

  alterarEndereco(novoEndereco: string): void {
    this.enderecoCompleto = novoEndereco;
  }

  atualizarCadastro(dados: { razaoSocial: string; inscricaoEstadual: string; enderecoCompleto: string; telefone: string; email: string }): void {
    this.razaoSocial = dados.razaoSocial;
    this.inscricaoEstadual = dados.inscricaoEstadual;
    this.enderecoCompleto = dados.enderecoCompleto;
    this.telefone = dados.telefone;
    this.email = dados.email;
  }

  adicionarContrato(contrato: Contrato): void {
    if (!this.ativo) throw new Error('Não é possível cadastrar contrato para uma organização desativada.');
    if (this.contratoVigente?.estaVigente()) throw new Error('A organização já possui um contrato vigente.');
    if (contrato.organizacaoId !== this.id) throw new Error('O contrato pertence a outra organização.');
    this.contratos.push(contrato);
    this.contratoVigente = contrato;
  }

  desativar(motivo = ''): void {
    if (!motivo.trim()) throw new Error('Informe o motivo da desativação da organização.');
    this.ativo = false;
    this.motivoDesativacao = motivo.trim();
  }
}
