# Tasks: 013 Service Config (Customer Service / Ads)

- [x] Spec 013 written (single ordered list, replace-all semantics)
- [x] RED: `src/service-config/service-config-math.spec.ts` (5 tests)
- [x] Schema: `ServiceConfigEntry`; migration `20260924000009_service_config` (local-first; deployed local)
- [x] GREEN: public active-only ordered read; platform full read; PUT replace-all (validate-all, delete-missing, upsert, spoofed-id 422, 100-cap, audited)
- [x] RLS: catalog exclusion + revoke; `db:check-rls` green
- [x] Boundary: `SYSTEM_PRISMA_JUSTIFICATIONS.md` §15 + allowlist; openapi public allowlist
- [x] E2E `test/service-config.e2e-spec.ts` (3 tests: replace+public order, reorder+delete, type/value/spoofed rejects)
- [x] `typecheck + lint + test` (284 unit) green; `docs:generate` regenerated
- [x] Dashboard: `/service-config` ordered editor (add/edit/remove/enable/reorder, save-all)
- [ ] Follow-up: prod deploy of migrations `...00004`–`...00009`
