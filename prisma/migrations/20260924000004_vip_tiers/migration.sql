-- Spec 008: VIP ranking tiers + Fleet.vipTierId (nullable, untiered sorts last).
-- NOTE: the `governorates.id DROP DEFAULT` drift statement reported by
-- `prisma migrate diff` is unrelated and intentionally excluded.

-- AlterTable
ALTER TABLE "fleets" ADD COLUMN     "vip_tier_id" UUID;

-- CreateTable
CREATE TABLE "vip_tiers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "rank" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vip_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vip_tiers_name_key" ON "vip_tiers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "vip_tiers_rank_key" ON "vip_tiers"("rank");

-- CreateIndex
CREATE INDEX "fleets_vip_tier_id_idx" ON "fleets"("vip_tier_id");

-- AddForeignKey
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_vip_tier_id_fkey" FOREIGN KEY ("vip_tier_id") REFERENCES "vip_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
