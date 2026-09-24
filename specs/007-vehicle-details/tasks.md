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
- [ ] Follow-up: Supabase Storage bucket + upload flow for `imageUrl` (no infra exists yet)
- [ ] Follow-up: backfill existing buses (plate/color/image) → NOT NULL enforcement
