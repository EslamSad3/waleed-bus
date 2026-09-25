-- Spec 006: geography hierarchy (Governorate → Markaz → Locality → Station).
-- Station.locality_id is nullable during the backfill transition; existing
-- stations keep working on governorateId until the backfill assigns localities.
-- NOTE: `prisma migrate diff` also reported drift on governorates.id default;
-- that unrelated statement is intentionally excluded from this migration.

-- AlterTable
ALTER TABLE "stations" ADD COLUMN     "locality_id" UUID;

-- CreateTable
CREATE TABLE "markazes" (
    "id" UUID NOT NULL,
    "governorate_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name_ar" VARCHAR(100) NOT NULL,
    "name_en" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "markazes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "localities" (
    "id" UUID NOT NULL,
    "markaz_id" UUID NOT NULL,
    "name_ar" VARCHAR(100) NOT NULL,
    "name_en" VARCHAR(100) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "localities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "markazes_code_key" ON "markazes"("code");

-- CreateIndex
CREATE INDEX "markazes_governorate_id_idx" ON "markazes"("governorate_id");

-- CreateIndex
CREATE INDEX "localities_markaz_id_idx" ON "localities"("markaz_id");

-- CreateIndex
CREATE INDEX "stations_locality_id_idx" ON "stations"("locality_id");

-- AddForeignKey
ALTER TABLE "markazes" ADD CONSTRAINT "markazes_governorate_id_fkey" FOREIGN KEY ("governorate_id") REFERENCES "governorates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "localities" ADD CONSTRAINT "localities_markaz_id_fkey" FOREIGN KEY ("markaz_id") REFERENCES "markazes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stations" ADD CONSTRAINT "stations_locality_id_fkey" FOREIGN KEY ("locality_id") REFERENCES "localities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
