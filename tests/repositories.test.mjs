import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { CredencialRepository } from '../dist/repositories/CredencialRepository.js';
import { ContratoRepository } from '../dist/repositories/ContratoRepository.js';
import { EquipamentoRepository } from '../dist/repositories/EquipamentoRepository.js';
import { LoteRepository } from '../dist/repositories/LoteRepository.js';
import { MovimentacaoRepository } from '../dist/repositories/MovimentacaoRepository.js';
import { OrganizacaoRepository } from '../dist/repositories/OrganizacaoRepository.js';

test('repositories persistem, consultam e atualizam as entidades sem misturar regras de negócio', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const id = `REPOSITORY-CHECK-${randomUUID()}`;
  let rollbackConfirmed = false;

  try {
    await prisma.$connect();
    try {
      await prisma.$transaction(async (tx) => {
        const organizacoes = new OrganizacaoRepository(tx);
        const contratos = new ContratoRepository(tx);
        const lotes = new LoteRepository(tx);
        const equipamentos = new EquipamentoRepository(tx);
        const movimentacoes = new MovimentacaoRepository(tx);
        const credenciais = new CredencialRepository(tx);

        await organizacoes.criar({
          id,
          razaoSocial: 'Repository test',
          cnpj: id,
          cnpjNormalizado: id,
          inscricaoEstadual: 'N/A',
          enderecoCompleto: 'N/A',
          telefone: 'N/A',
          email: 'repository@example.invalid',
        });
        assert.equal((await organizacoes.buscarPorCnpj(id))?.id, id);

        const contratoId = `${id}-CONTRACT`;
        await contratos.criar({
          id: contratoId,
          organizacaoId: id,
          dataAssinatura: new Date(),
          dataVencimento: new Date(Date.now() + 86400000),
          valorMensal: 100,
        });
        await organizacoes.atualizar(id, { contratoVigenteId: contratoId });
        assert.equal((await contratos.listarPorOrganizacao(id))[0]?.id, contratoId);

        const loteId = `${id}-LOT`;
        await lotes.criar({
          id: loteId,
          organizacaoId: id,
          dataEntrada: new Date(),
          notaFiscal: 'TEST',
          transportadora: 'TEST',
        });

        const equipamentoId = `${id}-DEVICE`;
        const codigoBarrasInterno = `${id}-BARCODE`;
        await equipamentos.criar({
          id: equipamentoId,
          codigoBarrasInterno,
          tipo: 'NOTEBOOK',
          marca: 'TEST',
          modelo: 'TEST',
          anoFabricacao: 2025,
          estadoFisico: 'BOM_ESTADO',
          pesoQuilogramas: 1,
          loteId,
          posicaoNoLote: 1,
        });
        assert.equal((await equipamentos.buscarPorCodigoBarras(codigoBarrasInterno))?.id, equipamentoId);
        assert.equal((await lotes.buscarComEquipamentos(loteId))?.equipamentos[0]?.id, equipamentoId);

        await movimentacoes.criar({
          id: `${id}-MOV`,
          equipamentoId,
          origem: 'TEST',
          destino: 'TEST',
          responsavel: 'TEST',
          observacao: 'TEST',
        });
        assert.equal((await equipamentos.buscarComMovimentacoes(equipamentoId))?.movimentacoes.length, 1);
        assert.equal((await movimentacoes.listarPorEquipamento(equipamentoId)).length, 1);

        await credenciais.criar({
          id: `${id}-USER`,
          usuario: id,
          hashSenha: 'test-hash',
          salt: 'test-salt',
          ultimoAcesso: new Date(),
          papel: 'AUDITOR',
          nomeExibicao: 'TEST',
        });
        assert.equal((await credenciais.buscarPorUsuarioAtivo(id))?.id, `${id}-USER`);

        await equipamentos.atualizar(equipamentoId, { marca: 'UPDATED' });
        assert.equal((await equipamentos.buscarPorId(equipamentoId))?.marca, 'UPDATED');
        assert.equal((await organizacoes.listar({ id }))[0]?.id, id);
        assert.equal((await lotes.listarPorOrganizacao(id))[0]?.id, loteId);

        throw new Error('ROLLBACK_REPOSITORY_CHECK');
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'ROLLBACK_REPOSITORY_CHECK') rollbackConfirmed = true;
      else throw error;
    }

    assert.equal(rollbackConfirmed, true);
    assert.equal(await prisma.organizacao.count({ where: { id } }), 0);
  } finally {
    await prisma.$disconnect();
  }
});
