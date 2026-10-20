import { Contrato } from '../domain/Contrato.js';
import { Organizacao } from '../domain/Organizacao.js';
import { RepositorioArquivo } from '../infra/RepositorioArquivo.js';
import { ValidadorCNPJ } from '../validators/ValidadorCNPJ.js';

export class ServicoOrganizacao {
  constructor(
    private repositorio: RepositorioArquivo,
    private validadorCNPJ: ValidadorCNPJ,
  ) {}

  cadastrarOrganizacao(dados: any): Organizacao {
    if (!this.validadorCNPJ.validar(dados.cnpj)) {
      throw new Error(this.validadorCNPJ.obterMensagemErro());
    }

    const cnpjNormalizado = dados.cnpj.replace(/\D/g, '');
    const existeCnpj = this.repositorio.listarEntidades('organizacoes').some(
      (organizacao) => organizacao.cnpj.replace(/\D/g, '') === cnpjNormalizado,
    );

    if (existeCnpj) {
      throw new Error('Já existe uma organização cadastrada com este CNPJ.');
    }

    const organizacao = new Organizacao(
      dados.id,
      dados.razaoSocial,
      dados.cnpj,
      dados.inscricaoEstadual,
      dados.enderecoCompleto,
      dados.telefone,
      dados.email,
      dados.dataCadastro ? new Date(dados.dataCadastro) : new Date(),
      dados.ativo ?? true,
      this.reconstituirContrato(dados.contratoVigente),
    );

    this.repositorio.salvarEntidade('organizacoes', organizacao);
    return organizacao;
  }

  buscarOrganizacao(id: string): Organizacao {
    const dados = this.repositorio.carregarEntidade('organizacoes', id);

    if (!dados) {
      throw new Error('Organização não encontrada.');
    }

    return this.reconstituirOrganizacao(dados);
  }

  listarOrganizacoes(incluirDesativadas = false): Organizacao[] {
    return this.repositorio.listarEntidades('organizacoes')
      .map((dados) => this.reconstituirOrganizacao(dados))
      .filter((organizacao) => incluirDesativadas || organizacao.ativo);
  }

  atualizarOrganizacao(id: string, dados: { razaoSocial: string; cnpj: string; inscricaoEstadual?: string; enderecoCompleto?: string; telefone?: string; email?: string }): Organizacao {
    const organizacao = this.buscarOrganizacao(id);
    if (!organizacao.ativo) throw new Error('Não é possível alterar uma organização desativada.');
    if (!this.validadorCNPJ.validar(dados.cnpj)) throw new Error(this.validadorCNPJ.obterMensagemErro());
    const cnpjNormalizado = dados.cnpj.replace(/\D/g, '');
    const duplicado = this.repositorio.listarEntidades('organizacoes').some((item) =>
      item.id !== id && item.cnpj.replace(/\D/g, '') === cnpjNormalizado,
    );
    if (duplicado) throw new Error('Já existe uma organização cadastrada com este CNPJ.');
    organizacao.razaoSocial = dados.razaoSocial.trim();
    if (!organizacao.razaoSocial) throw new Error('A razão social é obrigatória.');
    organizacao.cnpj = dados.cnpj;
    organizacao.atualizarCadastro({
      razaoSocial: organizacao.razaoSocial,
      inscricaoEstadual: dados.inscricaoEstadual ?? organizacao.inscricaoEstadual,
      enderecoCompleto: dados.enderecoCompleto ?? organizacao.enderecoCompleto,
      telefone: dados.telefone ?? organizacao.telefone,
      email: dados.email ?? organizacao.email,
    });
    this.repositorio.salvarEntidade('organizacoes', organizacao);
    return organizacao;
  }

  listarOrganizacoesAtivas(): Organizacao[] {
    return this.repositorio.listarEntidades('organizacoes')
      .map((dados) => this.reconstituirOrganizacao(dados))
      .filter((organizacao) => organizacao.ativo);
  }

  desativarOrganizacao(id: string, motivo: string): void {
    const organizacao = this.buscarOrganizacao(id);
    if (!organizacao.ativo) throw new Error('A organização já está desativada.');
    organizacao.desativar(motivo);
    this.repositorio.salvarEntidade('organizacoes', organizacao);
  }

  renovarContrato(organizacaoId: string, novoVencimento: Date): void {
    const organizacao = this.buscarOrganizacao(organizacaoId);
    if (!organizacao.ativo) throw new Error('Não é possível renovar contrato de uma organização desativada.');

    if (!organizacao.contratoVigente) {
      throw new Error('A organização não possui contrato vigente para renovar.');
    }

    organizacao.contratoVigente.renovar(novoVencimento);
    this.repositorio.salvarEntidade('organizacoes', organizacao);
  }

  cadastrarContrato(organizacaoId: string, dados: { id: string; dataAssinatura: Date; dataVencimento: Date; clausulas?: string[]; valorMensal: number; renovacaoAutomatica?: boolean }): Contrato {
    const organizacao = this.buscarOrganizacao(organizacaoId);
    if (!dados.id.trim()) throw new Error('O identificador do contrato é obrigatório.');
    if (!Number.isFinite(dados.valorMensal) || dados.valorMensal < 0) throw new Error('O valor mensal do contrato deve ser um número não negativo.');
    if (!(dados.dataAssinatura instanceof Date) || Number.isNaN(dados.dataAssinatura.getTime())) throw new Error('A data de assinatura do contrato é inválida.');
    if (!(dados.dataVencimento instanceof Date) || Number.isNaN(dados.dataVencimento.getTime()) || dados.dataVencimento <= dados.dataAssinatura) throw new Error('A data de vencimento deve ser posterior à assinatura.');
    if (this.repositorio.listarEntidades('organizacoes').some((item) => (item.contratos ?? (item.contratoVigente ? [item.contratoVigente] : [])).some((contrato: any) => contrato.id === dados.id))) {
      throw new Error('Já existe um contrato cadastrado com este identificador.');
    }
    const contrato = new Contrato(dados.id.trim(), organizacaoId, dados.dataAssinatura, dados.dataVencimento, dados.clausulas ?? [], dados.valorMensal, dados.renovacaoAutomatica ?? false);
    organizacao.adicionarContrato(contrato);
    this.repositorio.salvarEntidade('organizacoes', organizacao);
    return contrato;
  }

  listarContratos(organizacaoId: string): Contrato[] {
    return this.buscarOrganizacao(organizacaoId).contratos;
  }

  atualizarContrato(organizacaoId: string, contratoId: string, dados: { clausulas?: string[]; valorMensal?: number; renovacaoAutomatica?: boolean }): Contrato {
    const organizacao = this.buscarOrganizacao(organizacaoId);
    if (!organizacao.ativo) throw new Error('Não é possível alterar contrato de uma organização desativada.');
    const contrato = organizacao.contratos.find((item) => item.id === contratoId);
    if (!contrato) throw new Error('Contrato não encontrado para esta organização.');
    if (contrato.encerradoEm) throw new Error('Não é possível alterar um contrato encerrado.');
    if (dados.valorMensal !== undefined && (!Number.isFinite(dados.valorMensal) || dados.valorMensal < 0)) throw new Error('O valor mensal do contrato deve ser um número não negativo.');
    if (dados.clausulas !== undefined) contrato.clausulas = dados.clausulas;
    if (dados.valorMensal !== undefined) contrato.valorMensal = dados.valorMensal;
    if (dados.renovacaoAutomatica !== undefined) contrato.renovacaoAutomatica = dados.renovacaoAutomatica;
    this.repositorio.salvarEntidade('organizacoes', organizacao);
    return contrato;
  }

  encerrarContrato(organizacaoId: string): void {
    const organizacao = this.buscarOrganizacao(organizacaoId);
    if (!organizacao.contratoVigente) {
      throw new Error('A organização não possui contrato para encerrar.');
    }
    organizacao.contratoVigente.encerrar();
    this.repositorio.salvarEntidade('organizacoes', organizacao);
  }

  cancelarContrato(organizacaoId: string, contratoId: string): void {
    const organizacao = this.buscarOrganizacao(organizacaoId);
    const contrato = organizacao.contratos.find((item) => item.id === contratoId);
    if (!contrato) throw new Error('Contrato não encontrado para esta organização.');
    contrato.encerrar();
    if (organizacao.contratoVigente?.id === contrato.id) organizacao.contratoVigente = null;
    this.repositorio.salvarEntidade('organizacoes', organizacao);
  }

  private reconstituirOrganizacao(dados: any): Organizacao {
    return new Organizacao(
      dados.id,
      dados.razaoSocial,
      dados.cnpj,
      dados.inscricaoEstadual,
      dados.enderecoCompleto,
      dados.telefone,
      dados.email,
      new Date(dados.dataCadastro),
      dados.ativo,
      this.reconstituirContrato(dados.contratoVigente),
      dados.motivoDesativacao ?? null,
      (dados.contratos ?? (dados.contratoVigente ? [dados.contratoVigente] : [])).map((contrato: any) => this.reconstituirContrato(contrato)!),
    );
  }

  private reconstituirContrato(dados: any): Contrato | null {
    if (!dados) {
      return null;
    }

    return new Contrato(
      dados.id,
      dados.organizacaoId,
      new Date(dados.dataAssinatura),
      new Date(dados.dataVencimento),
      dados.clausulas,
      dados.valorMensal,
      dados.renovacaoAutomatica,
      dados.encerradoEm ? new Date(dados.encerradoEm) : null,
      (dados.historicoRenovacoes ?? []).map((renovacao: any) => ({
        dataVencimentoAnterior: new Date(renovacao.dataVencimentoAnterior),
        dataVencimentoNovo: new Date(renovacao.dataVencimentoNovo),
        registradoEm: new Date(renovacao.registradoEm),
      })),
    );
  }
}
