-- AlterTable
ALTER TABLE "Contrato" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Equipamento" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Lote" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ParametroGlobal" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;
