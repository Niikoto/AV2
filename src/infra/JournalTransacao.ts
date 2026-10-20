import { randomUUID } from 'node:crypto';

import type { RepositorioArquivo } from './RepositorioArquivo.js';

const ARQUIVO_JOURNAL = 'journal-transacoes';
const LIMITE_ROTACAO_BYTES = 10 * 1024 * 1024;

export type FaseJournal = 'INTENCAO' | 'CONFIRMACAO' | 'ABORTO' | 'REGISTRO';

export class JournalTransacao {
  constructor(
    public id: string,
    public timestamp: Date,
    public operacao: string,
    public entidade: string,
    public dadosAntes: any,
    public dadosDepois: any,
    public usuarioResponsavel: string,
    private repositorio: RepositorioArquivo,
    public transacaoId = id,
    public fase: FaseJournal = 'REGISTRO',
    public identificadorAnterior?: string,
    public resultado?: 'CONFIRMADA' | 'ABORTADA' | 'PENDENTE',
  ) {}

  registrar(): void {
    this.antesDeRegistrar();
    this.repositorio.salvarEntidadeSemJournal(ARQUIVO_JOURNAL, this);
  }

  reverter(): boolean {
    try {
      if (this.dadosAntes === null || this.dadosAntes === undefined) {
        const identificador = this.dadosDepois?.id ?? this.dadosDepois?.usuario;
        if (typeof identificador !== 'string') return false;
        this.repositorio.excluirEntidade(this.entidade, identificador);
      } else {
        this.repositorio.salvarEntidade(this.entidade, this.dadosAntes, this.identificadorAnterior);
      }
      return true;
    } catch {
      return false;
    }
  }

  static criar(
    operacao: string,
    entidade: string,
    dadosAntes: any,
    dadosDepois: any,
    usuarioResponsavel: string,
    repositorio: RepositorioArquivo,
  ): JournalTransacao {
    return new JournalTransacao(
      `journal-${randomUUID()}`,
      new Date(),
      operacao,
      entidade,
      dadosAntes,
      dadosDepois,
      usuarioResponsavel,
      repositorio,
      randomUUID(),
      'REGISTRO',
    );
  }

  static executar(
    repositorio: RepositorioArquivo,
    operacao: string,
    entidade: string,
    dadosAntes: any,
    dadosDepois: any,
    usuarioResponsavel: string,
    aplicar: () => void,
    identificadorAnterior?: string,
  ): void {
    const transacaoId = randomUUID();
    const intencao = new JournalTransacao(
      `journal-${randomUUID()}`,
      new Date(),
      operacao,
      entidade,
      dadosAntes,
      dadosDepois,
      usuarioResponsavel,
      repositorio,
      transacaoId,
      'INTENCAO',
      identificadorAnterior,
    );

    intencao.registrar();
    try {
      aplicar();
    } catch (erro) {
      JournalTransacao.registrarDesfecho(repositorio, intencao, 'ABORTO');
      throw erro;
    }
    JournalTransacao.registrarDesfecho(repositorio, intencao, 'CONFIRMACAO');
  }

  static recuperarPendentes(repositorio: RepositorioArquivo): number {
    const eventos = JournalTransacao.listarEventos(repositorio);
    const resolvidas = new Set(
      eventos.filter((evento) => evento.fase === 'CONFIRMACAO' || evento.fase === 'ABORTO')
        .map((evento) => evento.transacaoId),
    );
    const pendentes = eventos.filter((evento) => evento.fase === 'INTENCAO' && !resolvidas.has(evento.transacaoId));

    for (const intencao of pendentes) {
      if (intencao.dadosDepois === null || intencao.dadosDepois === undefined) {
        const identificador = intencao.dadosAntes?.id ?? intencao.dadosAntes?.usuario;
        if (typeof identificador !== 'string') {
          throw new Error(`Transação pendente ${intencao.transacaoId} sem identificador para exclusão.`);
        }
        repositorio.excluirEntidadeSemJournal(intencao.entidade, identificador);
      } else {
        repositorio.salvarEntidadeSemJournal(intencao.entidade, intencao.dadosDepois, intencao.identificadorAnterior);
      }
      JournalTransacao.registrarDesfecho(repositorio, intencao, 'CONFIRMACAO');
    }

    return pendentes.length;
  }

  static listar(repositorio: RepositorioArquivo): JournalTransacao[] {
    const eventos = JournalTransacao.listarEventos(repositorio);
    const desfechos = new Map<string, FaseJournal>();
    for (const evento of eventos) {
      if (evento.fase === 'CONFIRMACAO' || evento.fase === 'ABORTO') {
        desfechos.set(evento.transacaoId, evento.fase);
      }
    }

    return eventos
      .filter((evento) => evento.fase === 'INTENCAO' || evento.fase === 'REGISTRO')
      .map((evento) => {
        evento.resultado = evento.fase === 'REGISTRO'
          ? 'CONFIRMADA'
          : desfechos.get(evento.transacaoId) === 'CONFIRMACAO'
            ? 'CONFIRMADA'
            : desfechos.get(evento.transacaoId) === 'ABORTO' ? 'ABORTADA' : 'PENDENTE';
        return evento;
      })
      .sort((primeira, segunda) => primeira.timestamp.getTime() - segunda.timestamp.getTime());
  }

  private static listarEventos(repositorio: RepositorioArquivo): JournalTransacao[] {
    return repositorio.listarEntidadesPorPrefixo(ARQUIVO_JOURNAL)
      .map((dados) => new JournalTransacao(
        dados.id,
        new Date(dados.timestamp),
        dados.operacao,
        dados.entidade,
        dados.dadosAntes,
        dados.dadosDepois,
        dados.usuarioResponsavel,
        repositorio,
        dados.transacaoId ?? dados.id,
        dados.fase ?? 'REGISTRO',
        dados.identificadorAnterior,
        dados.resultado,
      ))
      .sort((primeira, segunda) => primeira.timestamp.getTime() - segunda.timestamp.getTime());
  }

  private static registrarDesfecho(
    repositorio: RepositorioArquivo,
    intencao: JournalTransacao,
    fase: 'CONFIRMACAO' | 'ABORTO',
  ): void {
    const desfecho = new JournalTransacao(
      `journal-${randomUUID()}`,
      new Date(),
      intencao.operacao,
      intencao.entidade,
      null,
      null,
      intencao.usuarioResponsavel,
      repositorio,
      intencao.transacaoId,
      fase,
    );
    desfecho.registrar();
  }

  private antesDeRegistrar(): void {
    if (this.repositorio.obterTamanhoArquivo(ARQUIVO_JOURNAL) >= LIMITE_ROTACAO_BYTES) {
      this.repositorio.rotacionarArquivo(
        ARQUIVO_JOURNAL,
        `${ARQUIVO_JOURNAL}-${Date.now()}-${randomUUID()}`,
      );
    }
  }
}
