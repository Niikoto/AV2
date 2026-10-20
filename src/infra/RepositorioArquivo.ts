import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { CriptografiaArquivo } from './CriptografiaArquivo.js';
import { JournalTransacao } from './JournalTransacao.js';

export interface OpcoesRepositorioArquivo {
  antesRenomear?: (caminhoTemporario: string, caminhoFinal: string) => void;
}

export class RepositorioArquivo {
  private usuarioResponsavel = 'sistema';

  constructor(
    public diretorioBase: string,
    public criptografia: CriptografiaArquivo,
    private chave: string,
    private opcoes: OpcoesRepositorioArquivo = {},
  ) {}

  salvarEntidade(nomeArquivo: string, entidade: any, identificadorAnterior?: string): void {
    const identificador = this.obterIdentificador(entidade);
    const entidades = this.listarEntidades(nomeArquivo);
    const indice = entidades.findIndex((item) => (
      this.obterIdentificador(item) === identificador
      || (identificadorAnterior !== undefined && this.obterIdentificador(item) === identificadorAnterior)
    ));
    const entidadeAnterior = indice === -1 ? null : entidades[indice];
    const anterior = entidadeAnterior
      ? this.snapshotJournal(nomeArquivo, entidadeAnterior, nomeArquivo === 'credenciais' && entidade?.ativo === false)
      : null;

    if (nomeArquivo === 'journal-transacoes') {
      this.salvarEntidadeSemJournal(nomeArquivo, entidade, identificadorAnterior);
      return;
    }

    JournalTransacao.executar(
      this,
      anterior ? 'ATUALIZAR' : 'CRIAR',
      nomeArquivo,
      anterior,
      this.snapshotJournal(nomeArquivo, entidade),
      this.usuarioResponsavel,
      () => this.salvarEntidadeSemJournal(nomeArquivo, entidade, identificadorAnterior),
      identificadorAnterior,
    );
  }

  salvarEntidadeSemJournal(nomeArquivo: string, entidade: any, identificadorAnterior?: string): void {
    const identificador = this.obterIdentificador(entidade);
    const entidades = this.listarEntidades(nomeArquivo);
    const indice = entidades.findIndex((item) => (
      this.obterIdentificador(item) === identificador
      || (identificadorAnterior !== undefined && this.obterIdentificador(item) === identificadorAnterior)
    ));
    if (indice === -1) entidades.push(entidade);
    else entidades[indice] = entidade;
    this.salvarLista(nomeArquivo, entidades);
  }

  carregarEntidade(nomeArquivo: string, id: string): any {
    return this.listarEntidades(nomeArquivo)
      .find((entidade) => this.obterIdentificador(entidade) === id) ?? null;
  }

  listarEntidades(nomeArquivo: string): any[] {
    const caminho = this.obterCaminho(nomeArquivo);

    if (!existsSync(caminho)) {
      return [];
    }

    const dadosCifrados = readFileSync(caminho, 'utf-8');
    const dadosDecifrados = this.criptografia.decifrar(dadosCifrados, this.chave);
    const entidades = JSON.parse(dadosDecifrados);

    if (!Array.isArray(entidades)) {
      throw new Error(`O arquivo ${nomeArquivo} não contém uma lista de entidades.`);
    }

    return entidades;
  }

  excluirEntidade(nomeArquivo: string, id: string): void {
    if (nomeArquivo === 'journal-transacoes') {
      throw new Error('O journal não pode ser excluído por operações comuns.');
    }
    const entidades = this.listarEntidades(nomeArquivo);
    const anterior = entidades.find((entidade) => this.obterIdentificador(entidade) === id);
    if (!anterior) return;
    JournalTransacao.executar(
      this,
      'EXCLUIR',
      nomeArquivo,
      JSON.parse(JSON.stringify(anterior)),
      null,
      this.usuarioResponsavel,
      () => this.excluirEntidadeSemJournal(nomeArquivo, id),
    );
  }

  excluirEntidadeSemJournal(nomeArquivo: string, id: string): void {
    const entidades = this.listarEntidades(nomeArquivo);
    const restantes = entidades.filter((entidade) => this.obterIdentificador(entidade) !== id);
    if (restantes.length !== entidades.length) this.salvarLista(nomeArquivo, restantes);
  }

  definirUsuarioResponsavel(usuarioId: string): void {
    this.usuarioResponsavel = usuarioId.trim() || 'sistema';
  }

  limparTemporariosOrfaos(): number {
    if (!existsSync(this.diretorioBase)) return 0;
    const temporarios = readdirSync(this.diretorioBase)
      .filter((arquivo) => arquivo.includes('.tmp-'))
      .filter((arquivo) => statSync(join(this.diretorioBase, arquivo)).isFile());
    for (const arquivo of temporarios) unlinkSync(join(this.diretorioBase, arquivo));
    return temporarios.length;
  }

  obterTamanhoArquivo(nomeArquivo: string): number {
    const caminho = this.obterCaminho(nomeArquivo);
    return existsSync(caminho) ? statSync(caminho).size : 0;
  }

  rotacionarArquivo(nomeArquivo: string, nomeArquivoRotacionado: string): void {
    const caminhoOrigem = this.obterCaminho(nomeArquivo);

    if (!existsSync(caminhoOrigem)) {
      return;
    }

    renameSync(caminhoOrigem, this.obterCaminho(nomeArquivoRotacionado));
  }

  listarEntidadesPorPrefixo(prefixo: string): any[] {
    if (!existsSync(this.diretorioBase)) {
      return [];
    }

    return readdirSync(this.diretorioBase)
      .filter((arquivo) => arquivo.startsWith(prefixo) && arquivo.endsWith('.txt'))
      .flatMap((arquivo) => this.lerEntidadesDoCaminho(join(this.diretorioBase, arquivo), arquivo));
  }

  private salvarLista(nomeArquivo: string, entidades: any[]): void {
    const diretorio = this.diretorioBase;
    const caminhoFinal = this.obterCaminho(nomeArquivo);
    const caminhoTemporario = `${caminhoFinal}.tmp-${process.pid}-${randomUUID()}`;
    const dadosCifrados = this.criptografia.cifrar(JSON.stringify(entidades), this.chave);

    mkdirSync(diretorio, { recursive: true });
    try {
      writeFileSync(caminhoTemporario, dadosCifrados, 'utf-8');
      this.opcoes.antesRenomear?.(caminhoTemporario, caminhoFinal);
      renameSync(caminhoTemporario, caminhoFinal);
    } catch (erro) {
      if (existsSync(caminhoTemporario)) unlinkSync(caminhoTemporario);
      throw erro;
    }
  }

  private obterCaminho(nomeArquivo: string): string {
    if (!nomeArquivo.trim() || nomeArquivo.includes('/') || nomeArquivo.includes('\\')) {
      throw new Error('Nome de arquivo inválido.');
    }

    return join(this.diretorioBase, `${nomeArquivo}.txt`);
  }

  private lerEntidadesDoCaminho(caminho: string, nomeArquivo: string): any[] {
    const dadosCifrados = readFileSync(caminho, 'utf-8');
    const dadosDecifrados = this.criptografia.decifrar(dadosCifrados, this.chave);
    const entidades = JSON.parse(dadosDecifrados);

    if (!Array.isArray(entidades)) {
      throw new Error(`O arquivo ${nomeArquivo} não contém uma lista de entidades.`);
    }

    return entidades;
  }

  private obterIdentificador(entidade: any): string {
    const identificador = entidade?.id ?? entidade?.usuario;

    if (typeof identificador !== 'string' || !identificador.trim()) {
      throw new Error('A entidade precisa possuir id ou usuario não vazio para ser persistida.');
    }

    return identificador;
  }

  private snapshotJournal(nomeArquivo: string, entidade: any, anonimizarCredencial = false): any {
    if (nomeArquivo === 'credenciais' && (entidade?.ativo === false || anonimizarCredencial)) {
      return {
        id: entidade.id,
        ativo: false,
        papel: entidade.papel,
        ultimoAcesso: entidade.ultimoAcesso,
      };
    }
    return JSON.parse(JSON.stringify(entidade));
  }
}
