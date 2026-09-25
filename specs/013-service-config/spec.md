# Feature Specification: Customer Service / Ads Configuration

**Feature Branch**: `feature/waleed-call-requirements`

**Created**: 2026-09-24

**Status**: Draft

**Input**: Call requirements plan `waleed-bus-implementation-plan.md` §§22–23, 91, 99, Release 7.

## Decisions

- Single global ordered list `ServiceConfigEntry`: `{ text (1-200), type, value, isActive, sortOrder }`.
  One list serves both customer-service contacts and promotional announcements (§22); the mobile
  app decides the interaction from `type`. No mobile-specific behavior embedded.
- Types: `PHONE` | `WHATSAPP` | `WEBSITE` only (validated app-layer, never a TS enum).
  Value rules: PHONE/WHATSAPP = `+?[0-9]{7,15}` (spaces/dashes stripped before check);
  WEBSITE = `http(s)://` URL ≤ 500 chars.
- Ordering: explicit `sortOrder` (0-based, contiguous). The dashboard sends the full ordered
  array; `PUT` replaces the whole list in one transaction: validate all → delete missing ids →
  upsert (update text/type/value/isActive/sortOrder, create without id) → done. Contiguity is
  normalized server-side from array position (client order wins).
- Endpoints: `GET /config/customer-service` — `@Public()`, active entries only, ordered, no auth;
  `GET /platform/config/customer-service` — full list incl. inactive (`@Platform()`);
  `PUT /platform/config/customer-service` — replace-all (`@Platform()`, audit-logged).
- Empty list is valid (mobile shows nothing). Max 100 entries per PUT (DoS guard).
- RLS: platform-global catalog, no fleet scoping → excluded + revoked (catalog pattern, like
  promotions); service uses the system path.
- No per-entry audit rows (one `config.customer_service.update` audit per PUT with entry count).

## Scenarios

1. PUT 3 entries (PHONE/WHATSAPP/WEBSITE) → 200, order preserved; public GET returns them ordered.
2. PUT with bad type → 422 `INVALID_CONFIG_TYPE`; bad phone → 422 `INVALID_CONFIG_VALUE`; bad URL → 422 `INVALID_CONFIG_VALUE`.
3. Inactive entry hidden from public GET, visible in platform GET.
4. Reorder via PUT array order → public order follows.
5. Remove entry (omit id) → deleted; unknown id in PUT → 422 `CONFIG_ENTRY_NOT_FOUND` (no silent create for spoofed ids — only id-less items are created).
6. >100 entries → 422 `CONFIG_TOO_LARGE`.
