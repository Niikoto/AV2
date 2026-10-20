import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('O seed de desenvolvimento não pode ser executado com NODE_ENV=production.');
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('Defina DATABASE_URL antes de executar o seed.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const agora = new Date();
const diasAtras = (dias) => new Date(agora.getTime() - dias * 24 * 60 * 60 * 1000);
const diasAdiante = (dias) => new Date(agora.getTime() + dias * 24 * 60 * 60 * 1000);

function gerarDigitoCnpj(digitos, pesos) {
  const soma = [...digitos].reduce((total, digito, indice) => (
    total + Number(digito) * pesos[indice]
  ), 0);
  const resto = soma % 11;
  return resto < 2 ? '0' : String(11 - resto);
}

function gerarCnpj(base) {
  const primeiro = gerarDigitoCnpj(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const segundo = gerarDigitoCnpj(
    `${base}${primeiro}`,
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  return `${base}${primeiro}${segundo}`;
}

async function upsertSemSobrescrever(delegate, id, create) {
  return delegate.upsert({
    where: { id },
    create,
    update: {},
  });
}

async function executarSeed() {
  const organizacoes = [
    {
      id: 'SEED-ORG-001',
      razaoSocial: 'Recicla Exemplo Ltda.',
      cnpj: gerarCnpj('123456780001'),
      inscricaoEstadual: 'ISENTO',
      enderecoCompleto: 'Rua da Reciclagem, 100 - São Paulo/SP',
      telefone: '(11) 4000-1000',
      email: 'contato@recicla-exemplo.invalid',
    },
    {
      id: 'SEED-ORG-002',
      razaoSocial: 'Tecnologia Circular S.A.',
      cnpj: gerarCnpj('987654320001'),
      inscricaoEstadual: 'ISENTO',
      enderecoCompleto: 'Avenida Circular, 200 - Campinas/SP',
      telefone: '(19) 4000-2000',
      email: 'contato@tecnologia-circular.invalid',
    },
  ];
  const contratos = organizacoes.map((organizacao, indice) => ({
    id: `SEED-CONTRACT-00${indice + 1}`,
    organizacaoId: organizacao.id,
    dataAssinatura: diasAtras(30),
    dataVencimento: diasAdiante(335),
    clausulas: ['Destinação ambientalmente adequada', 'Relatório mensal de rastreabilidade'],
    valorMensal: indice === 0 ? 1250 : 2100,
    renovacaoAutomatica: indice === 1,
  }));
  const lotes = [
    {
      id: 'SEED-LOT-001',
      organizacaoId: 'SEED-ORG-001',
      dataEntrada: diasAtras(2),
      notaFiscal: 'SEED-NF-001',
      transportadora: 'Transportes Exemplo',
      statusProcessamento: 'RECEBIDO',
      observacoes: 'Lote de demonstração aguardando triagem.',
    },
    {
      id: 'SEED-LOT-002',
      organizacaoId: 'SEED-ORG-002',
      dataEntrada: diasAtras(5),
      notaFiscal: 'SEED-NF-002',
      transportadora: 'Logística Circular',
      statusProcessamento: 'TRIAGEM_CONCLUIDA',
      observacoes: 'Lote de demonstração com equipamentos em diferentes etapas.',
    },
  ];
  const equipamentos = [
    {
      id: 'SEED-EQUIP-001',
      codigoBarrasInterno: 'SEED-BARCODE-001',
      tipo: 'NOTEBOOK',
      marca: 'Greencode',
      modelo: 'Notebook de demonstração',
      anoFabricacao: agora.getFullYear() - 3,
      estadoFisico: 'BOM_ESTADO',
      pesoQuilogramas: 2.1,
      loteId: 'SEED-LOT-001',
      posicaoNoLote: 1,
      statusRastreamento: 'AGUARDANDO_TRIAGEM',
      dataCadastro: diasAtras(2),
    },
    {
      id: 'SEED-EQUIP-002',
      codigoBarrasInterno: 'SEED-BARCODE-002',
      tipo: 'MONITOR',
      marca: 'Greencode',
      modelo: 'Monitor de demonstração',
      anoFabricacao: agora.getFullYear() - 5,
      estadoFisico: 'USADO_MODERADO',
      pesoQuilogramas: 4.4,
      loteId: 'SEED-LOT-002',
      posicaoNoLote: 1,
      statusRastreamento: 'EM_DESMONTE',
      dataCadastro: diasAtras(5),
    },
    {
      id: 'SEED-EQUIP-003',
      codigoBarrasInterno: 'SEED-BARCODE-003',
      tipo: 'COMPUTADOR_MESA',
      marca: 'Greencode',
      modelo: 'Computador de demonstração',
      anoFabricacao: agora.getFullYear() - 7,
      estadoFisico: 'DANIFICADO_LEVE',
      pesoQuilogramas: 8.7,
      loteId: 'SEED-LOT-002',
      posicaoNoLote: 2,
      statusRastreamento: 'MATERIAL_RECICLAVEL',
      dataCadastro: diasAtras(5),
    },
    {
      id: 'SEED-EQUIP-004',
      codigoBarrasInterno: 'SEED-BARCODE-004',
      tipo: 'IMPRESSORA',
      marca: 'Greencode',
      modelo: 'Impressora de demonstração',
      anoFabricacao: agora.getFullYear() - 9,
      estadoFisico: 'INSERVIVEL',
      pesoQuilogramas: 6.3,
      loteId: 'SEED-LOT-002',
      posicaoNoLote: 3,
      statusRastreamento: 'BAIXA_DEFINITIVA',
      dataCadastro: diasAtras(5),
    },
  ];
  const movimentacoes = [
    {
      id: 'SEED-MOVE-001',
      equipamentoId: 'SEED-EQUIP-001',
      dataHora: diasAtras(2),
      origem: 'RECEBIMENTO',
      destino: 'ÁREA DE TRIAGEM',
      responsavel: 'seed',
      observacao: 'Equipamento encaminhado para triagem.',
      tipoEvento: 'MOVIMENTACAO',
    },
    {
      id: 'SEED-MOVE-002',
      equipamentoId: 'SEED-EQUIP-002',
      dataHora: diasAtras(4),
      origem: 'AGUARDANDO_TRIAGEM',
      destino: 'AGUARDANDO_DESMONTE',
      responsavel: 'seed',
      observacao: 'Triagem concluída.',
      tipoEvento: 'STATUS',
    },
    {
      id: 'SEED-MOVE-003',
      equipamentoId: 'SEED-EQUIP-002',
      dataHora: diasAtras(3),
      origem: 'AGUARDANDO_DESMONTE',
      destino: 'EM_DESMONTE',
      responsavel: 'seed',
      observacao: 'Desmontagem iniciada.',
      tipoEvento: 'STATUS',
    },
    {
      id: 'SEED-MOVE-004',
      equipamentoId: 'SEED-EQUIP-003',
      dataHora: diasAtras(3),
      origem: 'EM_DESMONTE',
      destino: 'MATERIAL_RECICLAVEL',
      responsavel: 'seed',
      observacao: 'Materiais separados para reciclagem.',
      tipoEvento: 'STATUS',
    },
    {
      id: 'SEED-MOVE-005',
      equipamentoId: 'SEED-EQUIP-004',
      dataHora: diasAtras(2),
      origem: 'DESCARTE_SEGURO',
      destino: 'BAIXA_DEFINITIVA',
      responsavel: 'seed',
      observacao: 'Baixa registrada após destinação.',
      tipoEvento: 'STATUS',
    },
  ];

  await prisma.$transaction(async (tx) => {
    for (const organizacao of organizacoes) {
      await upsertSemSobrescrever(tx.organizacao, organizacao.id, {
        ...organizacao,
        cnpjNormalizado: organizacao.cnpj.replace(/\D/g, ''),
      });
    }

    for (const contrato of contratos) {
      await upsertSemSobrescrever(tx.contrato, contrato.id, contrato);
      const organizacao = await tx.organizacao.findUnique({
        where: { id: contrato.organizacaoId },
        select: { contratoVigenteId: true },
      });
      if (!organizacao) throw new Error(`Organização seed não encontrada: ${contrato.organizacaoId}.`);
      if (organizacao.contratoVigenteId && organizacao.contratoVigenteId !== contrato.id) {
        throw new Error(`A organização ${contrato.organizacaoId} já possui outro contrato vigente.`);
      }
      if (!organizacao.contratoVigenteId) {
        await tx.organizacao.updateMany({
          where: { id: contrato.organizacaoId, contratoVigenteId: null },
          data: { contratoVigenteId: contrato.id },
        });
      }
    }

    for (const lote of lotes) {
      await upsertSemSobrescrever(tx.lote, lote.id, lote);
    }
    for (const equipamento of equipamentos) {
      await upsertSemSobrescrever(tx.equipamento, equipamento.id, equipamento);
    }
    for (const movimentacao of movimentacoes) {
      await upsertSemSobrescrever(tx.movimentacao, movimentacao.id, movimentacao);
    }
  });

  console.log('Seed aplicado sem sobrescrever registros existentes:');
  console.log(`- ${organizacoes.length} organizações e ${contratos.length} contratos`);
  console.log(`- ${lotes.length} lotes e ${equipamentos.length} equipamentos`);
  console.log(`- ${movimentacoes.length} movimentações`);
}

try {
  await prisma.$connect();
  await executarSeed();
} catch (error) {
  console.error('Falha ao executar seed:', error instanceof Error ? error.message : 'erro desconhecido');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
