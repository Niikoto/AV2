import { randomUUID } from 'node:crypto';

import { RepositorioArquivo } from '../infra/RepositorioArquivo.js';
import { ServicoAutenticacao } from './ServicoAutenticacao.js';

export interface VersaoParametrosGlobais {
  id: string;
  versao: number;
  aliquotasImpostos: Record<string, number>;
  coeficienteDepreciacao: number;
  atualizadoEm: Date | null;
  atualizadoPor: string;
}

export interface AlteracaoParametrosGlobais {
  imposto?: string;
  aliquota?: number;
  coeficienteDepreciacao?: number;
}

export class ServicoParametrosGlobais {
  private readonly arquivo = 'parametros-globais';

  constructor(private repositorio: RepositorioArquivo, private autenticacao: ServicoAutenticacao) {}

  consultar(tokenAdministrador: string): VersaoParametrosGlobais {
    this.autenticacao.exigirPermissao(tokenAdministrador, 'GERENCIAR_PARAMETROS_GLOBAIS');
    return this.obterAtualInterna();
  }

  listarHistorico(tokenAdministrador: string): VersaoParametrosGlobais[] {
    this.autenticacao.exigirPermissao(tokenAdministrador, 'GERENCIAR_PARAMETROS_GLOBAIS');
    return this.repositorio.listarEntidades(this.arquivo)
      .map((registro) => this.reconstituir(registro))
      .sort((primeiro, segundo) => primeiro.versao - segundo.versao);
  }

  atualizar(tokenAdministrador: string, alteracao: AlteracaoParametrosGlobais, responsavel: string): VersaoParametrosGlobais {
    this.autenticacao.exigirPermissao(tokenAdministrador, 'GERENCIAR_PARAMETROS_GLOBAIS');
    const imposto = alteracao.imposto?.trim().toUpperCase();
    if ((imposto && alteracao.aliquota === undefined) || (!imposto && alteracao.aliquota !== undefined)) {
      throw new Error('Informe o nome do imposto e sua alíquota juntos.');
    }
    if (imposto && !/^[A-Z0-9_-]{2,30}$/.test(imposto)) throw new Error('O identificador do imposto deve conter de 2 a 30 letras, números, hífen ou sublinhado.');
    if (alteracao.aliquota !== undefined) this.validarTaxa(alteracao.aliquota, 'A alíquota');
    if (alteracao.coeficienteDepreciacao !== undefined) this.validarTaxa(alteracao.coeficienteDepreciacao, 'O coeficiente de depreciação');
    if (!imposto && alteracao.coeficienteDepreciacao === undefined) throw new Error('Informe ao menos uma alíquota ou o coeficiente de depreciação para atualizar.');

    const atual = this.obterAtualInterna();
    const aliquotasImpostos = { ...atual.aliquotasImpostos };
    if (imposto && alteracao.aliquota !== undefined) aliquotasImpostos[imposto] = alteracao.aliquota;
    const novaVersao: VersaoParametrosGlobais = {
      id: `PARAM-${String(atual.versao + 1).padStart(6, '0')}-${randomUUID()}`,
      versao: atual.versao + 1,
      aliquotasImpostos,
      coeficienteDepreciacao: alteracao.coeficienteDepreciacao ?? atual.coeficienteDepreciacao,
      atualizadoEm: new Date(),
      atualizadoPor: responsavel,
    };
    this.repositorio.salvarEntidade(this.arquivo, novaVersao);
    return novaVersao;
  }

  private obterAtualInterna(): VersaoParametrosGlobais {
    const historico = this.repositorio.listarEntidades(this.arquivo)
      .sort((primeiro, segundo) => segundo.versao - primeiro.versao);
    if (!historico.length) {
      return { id: 'PARAM-DEFAULT', versao: 0, aliquotasImpostos: {}, coeficienteDepreciacao: 0.08, atualizadoEm: null, atualizadoPor: 'sistema' };
    }
    return this.reconstituir(historico[0]);
  }

  private reconstituir(registro: any): VersaoParametrosGlobais {
    return { ...registro, atualizadoEm: registro.atualizadoEm ? new Date(registro.atualizadoEm) : null, aliquotasImpostos: { ...(registro.aliquotasImpostos ?? {}) } };
  }

  private validarTaxa(valor: number, rotulo: string): void {
    if (!Number.isFinite(valor) || valor < 0 || valor > 1) throw new Error(`${rotulo} deve estar entre 0 e 1 (0% a 100%).`);
  }
}
