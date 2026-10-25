CREATE TABLE "TokenRevogado" (
    "jti" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenRevogado_pkey" PRIMARY KEY ("jti")
);

CREATE INDEX "TokenRevogado_expiraEm_idx" ON "TokenRevogado"("expiraEm");
