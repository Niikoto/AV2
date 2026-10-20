-- CreateTable
CREATE TABLE "ParametroGlobal" (
    "id" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "aliquotasImpostos" JSONB NOT NULL,
    "coeficienteDepreciacao" DOUBLE PRECISION NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoPor" TEXT NOT NULL,

    CONSTRAINT "ParametroGlobal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoAuditoria" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operacao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "dadosAntes" JSONB,
    "dadosDepois" JSONB,
    "usuarioResponsavel" TEXT NOT NULL,
    "transacaoId" TEXT NOT NULL,
    "fase" TEXT NOT NULL,
    "identificadorAnterior" TEXT,

    CONSTRAINT "EventoAuditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ParametroGlobal_versao_key" ON "ParametroGlobal"("versao");

-- CreateIndex
CREATE INDEX "ParametroGlobal_atualizadoEm_idx" ON "ParametroGlobal"("atualizadoEm");

-- CreateIndex
CREATE INDEX "EventoAuditoria_timestamp_idx" ON "EventoAuditoria"("timestamp");

-- CreateIndex
CREATE INDEX "EventoAuditoria_transacaoId_fase_idx" ON "EventoAuditoria"("transacaoId", "fase");
