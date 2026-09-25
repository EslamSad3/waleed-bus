-- Spec 007: vehicle details + admin-managed brand dictionary.
-- New Bus columns are nullable-first: pre-existing rows stay valid; the
-- create-DTO layer requires plate/color/image for new buses. A later
-- backfill + NOT NULL enforcement follows once existing rows are migrated.
-- NOTE: the `governorates.id DROP DEFAULT` drift statement reported by
-- `prisma migrate diff` is unrelated and intentionally excluded.

-- AlterTable
ALTER TABLE "buses" ADD COLUMN     "brand_id" UUID,
ADD COLUMN     "color" VARCHAR(50),
ADD COLUMN     "image_url" VARCHAR(1024),
ADD COLUMN     "is_air_conditioned" BOOLEAN,
ADD COLUMN     "model_year" INTEGER;

-- CreateTable
CREATE TABLE "vehicle_brands" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_brands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_brands_name_key" ON "vehicle_brands"("name");

-- CreateIndex
CREATE INDEX "buses_brand_id_idx" ON "buses"("brand_id");

-- AddForeignKey
ALTER TABLE "buses" ADD CONSTRAINT "buses_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "vehicle_brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
