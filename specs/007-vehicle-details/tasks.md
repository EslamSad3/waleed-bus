# Tasks: 007 Vehicle Details + Brand Dictionary

- [x] Spec 007 written
- [x] RED: `src/buses/vehicle-brand.service.spec.ts` (4 tests)
- [x] Schema: `VehicleBrand`; `Bus.color/imageUrl/brandId/isAirConditioned/modelYear` (nullable-first)
- [x] Migration `20260924000003_vehicle_details` (deployed dev + test)
- [x] GREEN: `VehicleBrandService` + `/brands` platform CRUD (`buses.*` permissions) + audit
- [x] Bus create DTO requires plate/color/imageUrl; update retains image; brand must be active; modelYear ≤ currentYear+1 (`INVALID_VEHICLE_YEAR`)
- [x] Bus responses include `brand` + all new fields; `BusesService` audit-logs create/update
- [x] RLS: `vehicle_brands` catalog-excluded + revoked; `db:check-rls` green
- [x] Boundary: `buses/vehicle-brand.service.ts` allowlisted + justified (§10)
- [x] E2E `test/vehicle-details.e2e-spec.ts` (9 tests)
- [x] `typecheck + lint + test` (242 unit) green; `docs:generate` regenerated
- [ ] Dashboard: bus form fields + brands page (bus_dashboard branch)
- [x] Supabase Storage via CLI: `supabase/` linked project + migration `bus_images_bucket` (public-read bucket, 5MB, jpeg/png/webp) pushed with `supabase db push`; deployment step documented in README ("Supabase Storage — bus-images bucket", required per fresh environment) since Prisma cannot manage Storage objects
- [x] API `POST /fleets/:fleetId/uploads/bus-image` (fleet-scoped, `buses.update`): multer memory upload → magic-byte check → sharp compress (1600px max, q80/mozjpeg, png-9) → service_role upload → public URL; `STORAGE_NOT_CONFIGURED` 503 without keys
- [x] Deps: `@supabase/supabase-js`, `multer@2.2.0`, `sharp`, `@types/multer`; `.env.example` documents `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
- [x] Unit (6, sharp mocked) + e2e `test/uploads.e2e-spec.ts` (3, incl. real sharp decode) green
- [x] Dashboard bus create + edit are upload-only (edit shows current image display-only + Replace-via-upload; no manual URL field). API still accepts any absolute HTTPS URL (deliberate: backfill flexibility); canonical-source discipline at UI + upload endpoint
- [ ] Follow-up: backfill existing buses (plate/color/image) + stations (locality/coords) → NOT NULL enforcement (scope table in `docs/BOTH-backfill-runbook.md`)
