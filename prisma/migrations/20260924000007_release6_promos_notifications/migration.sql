-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "promo_code" VARCHAR(32),
ADD COLUMN     "promotion_id" UUID;

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "is_global" BOOLEAN NOT NULL DEFAULT true,
    "max_uses_per_user" INTEGER NOT NULL DEFAULT 1,
    "max_total_uses" INTEGER,
    "starts_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id"),
    -- Call §39: fixed monetary amount, never percentage-based.
    CONSTRAINT "promotions_type_check" CHECK ("type" = 'FIXED')
);
-- CreateTable
CREATE TABLE "promotion_targets" (
    "promotion_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    CONSTRAINT "promotion_targets_pkey" PRIMARY KEY ("promotion_id","user_id")
);
-- CreateTable
CREATE TABLE "promotion_usages" (
    "id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "discount_amount" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promotion_usages_pkey" PRIMARY KEY ("id")
);
-- CreateTable
-- Call §§43-44: TEXT (no refs), TRIP (trip_id), DISCOUNT_CODE (promotion_id).
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "trip_id" UUID,
    "promotion_id" UUID,
    "dedupe_key" VARCHAR(128),
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_category_check" CHECK ("category" IN ('TEXT', 'TRIP', 'DISCOUNT_CODE'))
);
-- CreateIndex
CREATE UNIQUE INDEX "promotions_code_key" ON "promotions"("code");
-- CreateIndex
CREATE INDEX "promotions_is_active_is_global_idx" ON "promotions"("is_active", "is_global");
-- CreateIndex
CREATE INDEX "promotion_targets_user_id_idx" ON "promotion_targets"("user_id");
-- CreateIndex
CREATE UNIQUE INDEX "promotion_usages_booking_id_key" ON "promotion_usages"("booking_id");
-- CreateIndex
CREATE INDEX "promotion_usages_promotion_id_idx" ON "promotion_usages"("promotion_id");
-- CreateIndex
CREATE INDEX "promotion_usages_user_id_idx" ON "promotion_usages"("user_id");
-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");
-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_created_at_idx" ON "notifications"("user_id", "is_read", "created_at");
-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "promotion_usages" ADD CONSTRAINT "promotion_usages_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
