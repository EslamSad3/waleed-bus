CREATE TABLE "governorates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(30) NOT NULL,
  "name_ar" VARCHAR(100) NOT NULL,
  "name_en" VARCHAR(100) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "governorates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "governorates_code_key" ON "governorates"("code");

INSERT INTO "governorates" ("code", "name_ar", "name_en", "updated_at") VALUES
  ('ALEXANDRIA', 'الإسكندرية', 'Alexandria', CURRENT_TIMESTAMP),
  ('ASWAN', 'أسوان', 'Aswan', CURRENT_TIMESTAMP),
  ('ASYUT', 'أسيوط', 'Asyut', CURRENT_TIMESTAMP),
  ('BEHEIRA', 'البحيرة', 'Beheira', CURRENT_TIMESTAMP),
  ('BENI_SUEF', 'بني سويف', 'Beni Suef', CURRENT_TIMESTAMP),
  ('CAIRO', 'القاهرة', 'Cairo', CURRENT_TIMESTAMP),
  ('DAKAHLIA', 'الدقهلية', 'Dakahlia', CURRENT_TIMESTAMP),
  ('DAMIETTA', 'دمياط', 'Damietta', CURRENT_TIMESTAMP),
  ('FAYOUM', 'الفيوم', 'Fayoum', CURRENT_TIMESTAMP),
  ('GHARBIA', 'الغربية', 'Gharbia', CURRENT_TIMESTAMP),
  ('GIZA', 'الجيزة', 'Giza', CURRENT_TIMESTAMP),
  ('ISMAILIA', 'الإسماعيلية', 'Ismailia', CURRENT_TIMESTAMP),
  ('KAFR_EL_SHEIKH', 'كفر الشيخ', 'Kafr El Sheikh', CURRENT_TIMESTAMP),
  ('LUXOR', 'الأقصر', 'Luxor', CURRENT_TIMESTAMP),
  ('MATROUH', 'مطروح', 'Matrouh', CURRENT_TIMESTAMP),
  ('MINYA', 'المنيا', 'Minya', CURRENT_TIMESTAMP),
  ('MONUFIA', 'المنوفية', 'Monufia', CURRENT_TIMESTAMP),
  ('NEW_VALLEY', 'الوادي الجديد', 'New Valley', CURRENT_TIMESTAMP),
  ('NORTH_SINAI', 'شمال سيناء', 'North Sinai', CURRENT_TIMESTAMP),
  ('PORT_SAID', 'بورسعيد', 'Port Said', CURRENT_TIMESTAMP),
  ('QALYUBIA', 'القليوبية', 'Qalyubia', CURRENT_TIMESTAMP),
  ('QENA', 'قنا', 'Qena', CURRENT_TIMESTAMP),
  ('RED_SEA', 'البحر الأحمر', 'Red Sea', CURRENT_TIMESTAMP),
  ('SHARQIA', 'الشرقية', 'Sharqia', CURRENT_TIMESTAMP),
  ('SOHAG', 'سوهاج', 'Sohag', CURRENT_TIMESTAMP),
  ('SOUTH_SINAI', 'جنوب سيناء', 'South Sinai', CURRENT_TIMESTAMP),
  ('SUEZ', 'السويس', 'Suez', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name_ar" = EXCLUDED."name_ar",
  "name_en" = EXCLUDED."name_en",
  "updated_at" = CURRENT_TIMESTAMP;

ALTER TABLE "stations" ADD COLUMN "governorate_id" UUID;

UPDATE "stations"
SET "governorate_id" = (SELECT "id" FROM "governorates" WHERE "code" = 'CAIRO')
WHERE "governorate_id" IS NULL;

ALTER TABLE "stations" ALTER COLUMN "governorate_id" SET NOT NULL;
CREATE INDEX "stations_governorate_id_idx" ON "stations"("governorate_id");
ALTER TABLE "stations" ADD CONSTRAINT "stations_governorate_id_fkey"
  FOREIGN KEY ("governorate_id") REFERENCES "governorates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
