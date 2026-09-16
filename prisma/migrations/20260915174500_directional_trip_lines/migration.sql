CREATE TABLE "lines" (
  "id" UUID NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "lines_code_key" ON "lines"("code");

ALTER TABLE "routes" ADD COLUMN "line_id" UUID;
ALTER TABLE "routes" ADD COLUMN "direction" VARCHAR(20) NOT NULL DEFAULT 'OUTBOUND';

INSERT INTO "lines" ("id", "name", "code", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), "name", "code", "is_active", "created_at", "updated_at" FROM "routes";
UPDATE "routes" r SET "line_id" = l."id" FROM "lines" l WHERE l."code" = r."code";
ALTER TABLE "routes" ALTER COLUMN "line_id" SET NOT NULL;
ALTER TABLE "routes" ADD CONSTRAINT "routes_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "routes_line_id_direction_key" ON "routes"("line_id", "direction");
CREATE INDEX "routes_line_id_idx" ON "routes"("line_id");

ALTER TABLE "buses" ADD COLUMN "line_id" UUID;
UPDATE "buses" b SET "line_id" = r."line_id" FROM "routes" r WHERE b."route_id" = r."id";
ALTER TABLE "buses" ADD CONSTRAINT "buses_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "buses_line_id_idx" ON "buses"("line_id");
ALTER TABLE "buses" DROP COLUMN "route_id";
