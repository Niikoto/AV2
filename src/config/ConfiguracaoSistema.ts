import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

export interface ConfiguracaoMestre {
  versao: number;
  saltProtecao: string;
  chaveMestraProtegida: string;
}

export class ConfiguracaoSistema {
  constructor(private caminhoArquivo: string) {}

  existe(): boolean {
    return existsSync(this.caminhoArquivo);
  }

  carregar(): ConfiguracaoMestre {
    if (!this.existe()) {
      throw new Error('Arquivo de configuração mestre não encontrado.');
    }

    const configuracao = JSON.parse(readFileSync(this.caminhoArquivo, 'utf-8')) as ConfiguracaoMestre;

    if (
      configuracao.versao !== 1
      || typeof configuracao.saltProtecao !== 'string'
      || typeof configuracao.chaveMestraProtegida !== 'string'
    ) {
      throw new Error('Arquivo de configuração mestre inválido.');
    }

    return configuracao;
  }

  salvar(configuracao: ConfiguracaoMestre): void {
    const diretorio = dirname(this.caminhoArquivo);
    const caminhoTemporario = `${this.caminhoArquivo}.tmp-${process.pid}-${randomUUID()}`;

    mkdirSync(diretorio, { recursive: true });
    try {
      writeFileSync(caminhoTemporario, JSON.stringify(configuracao, null, 2), 'utf-8');
      renameSync(caminhoTemporario, this.caminhoArquivo);
    } catch (erro) {
      if (existsSync(caminhoTemporario)) unlinkSync(caminhoTemporario);
      throw erro;
    }
  }
}
