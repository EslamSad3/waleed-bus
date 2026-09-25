-- CreateTable
CREATE TABLE "service_config_entries" (
    "id" UUID NOT NULL,
    "text" VARCHAR(200) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "value" VARCHAR(500) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_config_entries_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "service_config_entries_is_active_sort_order_idx" ON "service_config_entries"("is_active", "sort_order");
