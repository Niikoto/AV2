-- CreateEnum
CREATE TYPE "PapelUsuario" AS ENUM ('ADMINISTRADOR', 'OPERADOR_CADASTRO', 'GESTOR_ALMOXARIFADO', 'AUDITOR');

-- CreateEnum
CREATE TYPE "EstadoFisico" AS ENUM ('NOVO', 'BOM_ESTADO', 'USADO_LEVE', 'USADO_MODERADO', 'DANIFICADO_LEVE', 'DANIFICADO_GRAVE', 'INSERVIVEL');

-- CreateEnum
CREATE TYPE "StatusLote" AS ENUM ('RECEBIDO', 'EM_TRIAGEM', 'TRIAGEM_CONCLUIDA', 'ENCAMINHADO', 'FINALIZADO');

-- CreateEnum
CREATE TYPE "StatusRastreamento" AS ENUM ('AGUARDANDO_TRIAGEM', 'EM_TRIAGEM', 'AGUARDANDO_DESMONTE', 'EM_DESMONTE', 'PECAS_REAPROVEITADAS', 'MATERIAL_RECICLAVEL', 'DESCARTE_SEGURO', 'BAIXA_DEFINITIVA');

-- CreateEnum
CREATE TYPE "TipoEquipamento" AS ENUM ('COMPUTADOR_MESA', 'NOTEBOOK', 'MONITOR', 'IMPRESSORA', 'SERVIDOR', 'ROTEADOR', 'CABO_ESTRUTURADO', 'FONTE_ALIMENTACAO');

-- CreateEnum
CREATE TYPE "TipoEventoMovimentacao" AS ENUM ('MOVIMENTACAO', 'STATUS', 'ESTADO_FISICO', 'CANCELAMENTO', 'CORRECAO', 'ESTORNO');

-- CreateTable
CREATE TABLE "Organizacao" (
    "id" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "inscricaoEstadual" TEXT NOT NULL,
    "enderecoCompleto" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "dataCadastro" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "motivoDesativacao" TEXT,
    "contratoVigenteId" TEXT,

    CONSTRAINT "Organizacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contrato" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "dataAssinatura" TIMESTAMP(3) NOT NULL,
    "dataVencimento" TIMESTAMP(3) NOT NULL,
    "clausulas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "valorMensal" DOUBLE PRECISION NOT NULL,
    "renovacaoAutomatica" BOOLEAN NOT NULL DEFAULT false,
    "encerradoEm" TIMESTAMP(3),
    "historicoRenovacoes" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "Contrato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lote" (
    "id" TEXT NOT NULL,
    "dataEntrada" TIMESTAMP(3) NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "notaFiscal" TEXT NOT NULL,
    "transportadora" TEXT NOT NULL,
    "statusProcessamento" "StatusLote" NOT NULL DEFAULT 'RECEBIDO',
    "observacoes" TEXT NOT NULL DEFAULT '',
    "cancelado" BOOLEAN NOT NULL DEFAULT false,
    "motivoCancelamento" TEXT,

    CONSTRAINT "Lote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipamento" (
    "id" TEXT NOT NULL,
    "codigoBarrasInterno" TEXT NOT NULL,
    "tipo" "TipoEquipamento" NOT NULL,
    "marca" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "anoFabricacao" INTEGER NOT NULL,
    "estadoFisico" "EstadoFisico" NOT NULL,
    "pesoQuilogramas" DOUBLE PRECISION NOT NULL,
    "loteId" TEXT NOT NULL,
    "posicaoNoLote" INTEGER NOT NULL,
    "statusRastreamento" "StatusRastreamento" NOT NULL DEFAULT 'AGUARDANDO_TRIAGEM',
    "cancelado" BOOLEAN NOT NULL DEFAULT false,
    "motivoCancelamento" TEXT,
    "dataCadastro" TIMESTAMP(3),

    CONSTRAINT "Equipamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Movimentacao" (
    "id" TEXT NOT NULL,
    "equipamentoId" TEXT NOT NULL,
    "dataHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origem" TEXT NOT NULL,
    "destino" TEXT NOT NULL,
    "responsavel" TEXT NOT NULL,
    "observacao" TEXT NOT NULL,
    "tipoEvento" "TipoEventoMovimentacao" NOT NULL DEFAULT 'MOVIMENTACAO',
    "movimentacaoReferenciadaId" TEXT,
    "destinoCorrigido" TEXT,

    CONSTRAINT "Movimentacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credencial" (
    "id" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "hashSenha" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "ultimoAcesso" TIMESTAMP(3) NOT NULL,
    "papel" "PapelUsuario" NOT NULL,
    "nomeExibicao" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Credencial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organizacao_cnpj_key" ON "Organizacao"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "Organizacao_id_contratoVigenteId_key" ON "Organizacao"("id", "contratoVigenteId");

-- CreateIndex
CREATE INDEX "Contrato_organizacaoId_idx" ON "Contrato"("organizacaoId");

-- CreateIndex
CREATE UNIQUE INDEX "Contrato_organizacaoId_id_key" ON "Contrato"("organizacaoId", "id");

-- CreateIndex
CREATE INDEX "Lote_organizacaoId_dataEntrada_idx" ON "Lote"("organizacaoId", "dataEntrada");

-- CreateIndex
CREATE UNIQUE INDEX "Equipamento_codigoBarrasInterno_key" ON "Equipamento"("codigoBarrasInterno");

-- CreateIndex
CREATE INDEX "Equipamento_loteId_statusRastreamento_idx" ON "Equipamento"("loteId", "statusRastreamento");

-- CreateIndex
CREATE UNIQUE INDEX "Equipamento_loteId_posicaoNoLote_key" ON "Equipamento"("loteId", "posicaoNoLote");

-- CreateIndex
CREATE UNIQUE INDEX "Movimentacao_movimentacaoReferenciadaId_key" ON "Movimentacao"("movimentacaoReferenciadaId");

-- CreateIndex
CREATE INDEX "Movimentacao_equipamentoId_dataHora_idx" ON "Movimentacao"("equipamentoId", "dataHora");

-- CreateIndex
CREATE INDEX "Credencial_usuario_ativo_idx" ON "Credencial"("usuario", "ativo");

-- AddForeignKey
ALTER TABLE "Organizacao" ADD CONSTRAINT "Organizacao_id_contratoVigenteId_fkey" FOREIGN KEY ("id", "contratoVigenteId") REFERENCES "Contrato"("organizacaoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipamento" ADD CONSTRAINT "Equipamento_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "Lote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimentacao" ADD CONSTRAINT "Movimentacao_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "Equipamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimentacao" ADD CONSTRAINT "Movimentacao_movimentacaoReferenciadaId_fkey" FOREIGN KEY ("movimentacaoReferenciadaId") REFERENCES "Movimentacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
