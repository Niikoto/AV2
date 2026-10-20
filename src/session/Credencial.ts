import { createHash, randomUUID } from 'node:crypto';

import { PapelUsuario } from '../types/PapelUsuario.js';
import { Autenticavel } from './Autenticavel.js';

export class Credencial implements Autenticavel {
  constructor(
    public usuario: string,
    public hashSenha: string,
    public salt: string,
    public ultimoAcesso: Date,
    public papel: PapelUsuario,
    public nomeExibicao = usuario,
    public id = randomUUID(),
    public ativo = true,
  ) {}

  autenticar(usuario: string, senha: string): boolean {
    return this.ativo && this.usuario === usuario && this.verificarSenha(senha);
  }

  renovarToken(): string {
    return randomUUID();
  }

  verificarSenha(senhaPlana: string): boolean {
    if (!this.ativo || !this.hashSenha || !this.salt) return false;
    const hashInformado = createHash('sha256')
      .update(`${this.salt}:${senhaPlana}`, 'utf-8')
      .digest('hex');

    return hashInformado === this.hashSenha;
  }

  atualizarUltimoAcesso(): void {
    this.ultimoAcesso = new Date();
  }

  desativar(): void {
    this.ativo = false;
    this.usuario = '';
    this.nomeExibicao = '';
    this.hashSenha = '';
    this.salt = '';
  }
}
