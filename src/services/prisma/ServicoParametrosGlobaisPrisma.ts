import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { PapelUsuario } from '../../generated/prisma/enums.js';
import { EventoAuditoriaRepository } from '../../repositories/EventoAuditoriaRepository.js';
import { ParametroGlobalRepository } from '../../repositories/ParametroGlobalRepository.js';
import type {
  AlteracaoParametrosGlobais,
  VersaoParametrosGlobais,
} from '../ServicoParametrosGlobais.js';

type CredencialDbClient = Pick<Prisma.TransactionClient, 'credencial'>;

export class ServicoParametrosGlobaisPrisma {
  constructor(private prisma: PrismaClient) {}

  async consultar(administradorId: string): Promise<VersaoParametrosGlobais> {
    await this.exigirAdministrador(this.prisma, administradorId);
    const atual = await new ParametroGlobalRepository(this.prisma).buscarAtual();
    return atual ? this.publicar(atual) : this.padrao();
  }

  async listarHistorico(administradorId: string): Promise<VersaoParametrosGlobais[]> {
    await this.exigirAdministrador(this.prisma, administradorId);
    const historico = await new ParametroGlobalRepository(this.prisma).listarHistorico();
    return historico.map((versao) => this.publicar(versao));
  }

  async atualizar(
    administradorId: string,
    alteracao: AlteracaoParametrosGlobais,
    responsavel: string,
  ): Promise<VersaoParametrosGlobais> {
    this.validarAlteracao(alteracao);
    if (!responsavel.trim()) throw new Error('O responsável pela alteração é obrigatório.');

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.exigirAdministrador(tx, administradorId);
        const repository = new ParametroGlobalRepository(tx);
        const atual = await repository.buscarAtual();
        const atualPublico = atual ? this.publicar(atual) : this.padrao();
        const imposto = alteracao.imposto?.trim().toUpperCase();
        const aliquotasImpostos = { ...atualPublico.aliquotasImpostos };
        if (imposto && alteracao.aliquota !== undefined) {
          aliquotasImpostos[imposto] = alteracao.aliquota;
        }

        const novaVersao = {
          id: `PARAM-${String(atualPublico.versao + 1).padStart(6, '0')}-${randomUUID()}`,
          versao: atualPublico.versao + 1,
          aliquotasImpostos,
          coeficienteDepreciacao: alteracao.coeficienteDepreciacao
            ?? atualPublico.coeficienteDepreciacao,
          atualizadoEm: new Date(),
          atualizadoPor: responsavel.trim(),
        };
        const persistida = await repository.criar({
          ...novaVersao,
          aliquotasImpostos: novaVersao.aliquotasImpostos as Prisma.InputJsonValue,
        });
        await new EventoAuditoriaRepository(tx).criar({
          id: `audit-${randomUUID()}`,
          timestamp: novaVersao.atualizadoEm,
          operacao: 'ATUALIZAR',
          entidade: 'parametros-globais',
          dadosAntes: atual
            ? this.snapshotAuditavel(atual)
            : { versao: 0, coeficienteDepreciacao: 0.08, aliquotasImpostos: {} },
          dadosDepois: this.snapshotAuditavel(persistida),
          usuarioResponsavel: administradorId,
          transacaoId: randomUUID(),
          fase: 'REGISTRO',
        });
        return this.publicar(persistida);
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (this.isConflitoDeVersao(error)) {
        throw new Error('Conflito ao salvar parâmetros globais. Recarregue a versão atual e tente novamente.');
      }
      throw error;
    }
  }

  private validarAlteracao(alteracao: AlteracaoParametrosGlobais): void {
    const imposto = alteracao.imposto?.trim().toUpperCase();
    if ((imposto && alteracao.aliquota === undefined) || (!imposto && alteracao.aliquota !== undefined)) {
      throw new Error('Informe o nome do imposto e sua alíquota juntos.');
    }
    if (imposto && !/^[A-Z0-9_-]{2,30}$/.test(imposto)) {
      throw new Error('O identificador do imposto deve conter de 2 a 30 letras, números, hífen ou sublinhado.');
    }
    if (alteracao.aliquota !== undefined) this.validarTaxa(alteracao.aliquota, 'A alíquota');
    if (alteracao.coeficienteDepreciacao !== undefined) {
      this.validarTaxa(alteracao.coeficienteDepreciacao, 'O coeficiente de depreciação');
    }
    if (!imposto && alteracao.coeficienteDepreciacao === undefined) {
      throw new Error('Informe ao menos uma alíquota ou o coeficiente de depreciação para atualizar.');
    }
  }

  private async exigirAdministrador(
    prisma: CredencialDbClient,
    administradorId: string,
  ): Promise<void> {
    const credencial = await prisma.credencial.findUnique({
      where: { id: administradorId },
      select: { ativo: true, papel: true },
    });
    if (!credencial?.ativo || credencial.papel !== PapelUsuario.ADMINISTRADOR) {
      throw new Error('Usuário não autenticado ou sem permissão para esta operação.');
    }
  }

  private validarTaxa(valor: number, rotulo: string): void {
    if (!Number.isFinite(valor) || valor < 0 || valor > 1) {
      throw new Error(`${rotulo} deve estar entre 0 e 1 (0% a 100%).`);
    }
  }

  private isConflitoDeVersao(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error)) return false;
    if (error.code === 'P2034') return true;
    if (error.code !== 'P2002' || !('meta' in error) || typeof error.meta !== 'object' || error.meta === null) {
      return false;
    }
    if (!('target' in error.meta)) return false;
    const target = error.meta.target;
    return Array.isArray(target)
      ? target.includes('versao')
      : String(target).includes('ParametroGlobal_versao_key');
  }

  private padrao(): VersaoParametrosGlobais {
    return {
      id: 'PARAM-DEFAULT',
      versao: 0,
      aliquotasImpostos: {},
      coeficienteDepreciacao: 0.08,
      atualizadoEm: null,
      atualizadoPor: 'sistema',
    };
  }

  private publicar(versao: {
    id: string;
    versao: number;
    aliquotasImpostos: Prisma.JsonValue;
    coeficienteDepreciacao: number;
    atualizadoEm: Date | null;
    atualizadoPor: string;
  }): VersaoParametrosGlobais {
    const taxas = versao.aliquotasImpostos;
    if (typeof taxas !== 'object' || taxas === null || Array.isArray(taxas)) {
      throw new Error(`Configuração inválida nas alíquotas da versão ${versao.versao}.`);
    }
    const aliquotasImpostos: Record<string, number> = {};
    for (const [imposto, aliquota] of Object.entries(taxas)) {
      if (typeof aliquota !== 'number' || !Number.isFinite(aliquota)) {
        throw new Error(`Alíquota inválida para ${imposto} na versão ${versao.versao}.`);
      }
      aliquotasImpostos[imposto] = aliquota;
    }
    return { ...versao, aliquotasImpostos };
  }

  private snapshotAuditavel(versao: {
    id: string;
    versao: number;
    aliquotasImpostos: Prisma.JsonValue;
    coeficienteDepreciacao: number;
    atualizadoEm: Date;
    atualizadoPor: string;
  }): Prisma.InputJsonObject {
    return {
      id: versao.id,
      versao: versao.versao,
      aliquotasImpostos: versao.aliquotasImpostos as Prisma.InputJsonValue,
      coeficienteDepreciacao: versao.coeficienteDepreciacao,
      atualizadoEm: versao.atualizadoEm.toISOString(),
      atualizadoPor: versao.atualizadoPor,
    };
  }
}
