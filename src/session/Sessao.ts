import { randomUUID } from 'node:crypto';

import { PapelUsuario } from '../types/PapelUsuario.js';
import { Autenticavel } from './Autenticavel.js';

export class Sessao implements Autenticavel {
  constructor(
    public token: string,
    public usuario: string,
    public papel: PapelUsuario,
    public criacao: Date,
    public expiracao: Date,
    public usuarioId = '',
  ) {}

  autenticar(usuario: string, senha: string): boolean {
    void senha;
    return this.usuario === usuario && this.isValida();
  }

  renovarToken(): string {
    this.token = randomUUID();
    this.renovar();
    return this.token;
  }

  isValida(): boolean {
    return new Date() < this.expiracao;
  }

  renovar(): void {
    this.expiracao = new Date(Date.now() + 30 * 60 * 1000);
  }
}
