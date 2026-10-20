ALTER TABLE "Organizacao" ADD COLUMN "cnpjNormalizado" TEXT;

UPDATE "Organizacao"
SET "cnpjNormalizado" = regexp_replace("cnpj", '[^0-9]', '', 'g');

ALTER TABLE "Organizacao" ALTER COLUMN "cnpjNormalizado" SET NOT NULL;

CREATE UNIQUE INDEX "Organizacao_cnpjNormalizado_key" ON "Organizacao"("cnpjNormalizado");

DROP INDEX "Credencial_usuario_ativo_idx";

CREATE UNIQUE INDEX "Credencial_usuario_ativo_key" ON "Credencial"("usuario", "ativo");
