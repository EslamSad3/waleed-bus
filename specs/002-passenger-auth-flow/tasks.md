# Tasks: Passenger Auth Flow

**Input**: Design documents from `/specs/002-passenger-auth-flow/` (spec.md, plan.md, research.md, data-model.md, contracts/, quickstart.md)

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md — all present. Constitution mandates TDD: every phase writes failing tests first.

**Tests**: Included — required by constitution principle IV (red → green, e2e on real PostgreSQL, coverage ≥80%).

**Organization**: Grouped by user story (US1–US5 from spec.md) for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story the task belongs to (US1–US5)
- Exact file paths in every description

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Tooling, env contract, module shell

- [X] T001 Add OTP_FIXED_CODE, GOOGLE_CLIENT_ID, APPLE_CLIENT_ID placeholders to .env.example
- [X] T002 [P] Record green baseline: run pnpm test:e2e and note passing suite before changes
- [X] T003 [P] Create src/passenger-auth/passenger-auth.module.ts shell and register it in src/app.module.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, shared services, and cross-cutting extensions every story needs

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Extend prisma/schema.prisma: User phone columns (phoneNumber unique, phoneVerifiedAt, picture, nullable email) + UserAuthProvider + PhoneVerificationChallenge + ThrottleCounter models
- [X] T005 Create migration seeding roles(slug='passenger'), then run pnpm db:generate, pnpm db:migrate:deploy, pnpm db:setup-rls, pnpm db:check-rls (app_tenant gets no grants on new tables)
- [X] T006 [P] Implement normalizePhone helper with unit spec in src/passenger-auth/phone.util.ts (local/+20/0020 → 01XXXXXXXXX)
- [X] T007 [P] Implement ThrottleService with unit spec in src/passenger-auth/throttle.service.ts (DB-backed key/count/window_start counters via system path)
- [X] T008 Extend AllExceptionsFilter error body with code/details/retryAfter plus unit spec in src/common/filters/all-exceptions.filter.ts
- [X] T009 Derive profileScope (restricted/full) from live verification state in src/auth/guards/jwt-auth.guard.ts plus @AllowRestricted() decorator in src/common/decorators/profile-scope.decorator.ts with unit spec
- [X] T010 [P] Create passenger DTOs (RegisterDto, SendOtpDto, VerifyOtpDto, UpdateMeDto) with class-validator rules in src/passenger-auth/dto/passenger-auth.dto.ts

**Checkpoint**: Foundation ready — migration applied, RLS check green, shared services unit-tested; story work can begin

---

## Phase 3: User Story 1 - Register with phone, password, OTP verification (Priority: P1) 🎯 MVP

**Goal**: New passenger registers (name+phone+password), receives challenge, verifies fixed code `123456`, account becomes active

**Independent Test**: quickstart.md Scenario 1 — register → verify → profileComplete:true; fixed code verifies first attempt; replay/expired/concurrent-verify rejected

### Tests for User Story 1 ⚠️ WRITE FIRST, FAIL BEFORE IMPLEMENTATION

- [X] T011 [P] [US1] OtpService unit spec covering expiry, 5-guess lockout, single-use replay rejection, and fixed-code acceptance in src/passenger-auth/otp.service.spec.ts
- [X] T012 [P] [US1] E2E register→send→verify→active flow plus replay/expired cases in test/passenger-auth.e2e-spec.ts

### Implementation for User Story 1

- [X] T013 [US1] Implement OtpService challenge lifecycle in src/passenger-auth/otp.service.ts (upsert-per-phone, 5-min expiry, attempts counter, SELECT FOR UPDATE consume; resend starts fresh budget)
- [X] T014 [US1] Implement POST /auth/register, POST /auth/phone/send-otp, POST /auth/phone/verify-otp in src/passenger-auth/passenger-auth.controller.ts (pending user + passenger role, byte-identical anti-enumeration response on duplicate phone)
- [X] T015 [US1] Emit auth.register, otp.send, otp.verify.success/failure audit events without secrets in src/passenger-auth/otp.service.ts and src/passenger-auth/passenger-auth.controller.ts
- [X] T016 [US1] Add Swagger annotations for the three endpoints in src/passenger-auth/passenger-auth.controller.ts

**Checkpoint**: US1 fully functional and testable independently (throttle wiring arrives in US5; budgets enforced at service level already for attempts/expiry)

---

## Phase 4: User Story 2 - Log in with phone and password (Priority: P1)

**Goal**: Verified passenger logs in with phone+password; unverified-correct credentials get PHONE_NOT_VERIFIED; everything else gets the generic 401

**Independent Test**: quickstart.md Scenario 2 — correct login issues token pair; unverified→403; wrong/unknown/mismatched→identical 401s

### Tests for User Story 2 ⚠️ WRITE FIRST, FAIL BEFORE IMPLEMENTATION

- [X] T017 [P] [US2] AuthService passenger-login unit spec (success claims, PHONE_NOT_VERIFIED, generic failures, dummy-hash path, audit) in src/auth/auth.service.spec.ts
- [X] T018 [P] [US2] E2E login matrix section in test/passenger-auth.e2e-spec.ts

### Implementation for User Story 2

- [X] T019 [US2] Implement passenger phone login in src/auth/auth.service.ts (normalize → lookup → argon2/dummy-hash → verified? tokens : PHONE_NOT_VERIFIED → audit success/failure)
- [X] T020 [US2] Add loginType-union DTOs and wire passenger variants in src/auth/dto/auth.dto.ts and src/auth/auth.controller.ts (absent loginType preserves legacy email login)

**Checkpoint**: US1 and US2 both work; legacy email login unchanged (existing auth e2e still green)

---

## Phase 5: User Story 3 - Google/Apple login with phone completion (Priority: P2)

**Goal**: Provider identity links/creates passenger, restricted session issued, phone verified, session upgrades to full

**Independent Test**: quickstart.md Scenario 3 — mocked provider token → restricted token → profile incomplete → verify → full scope without re-login

**Depends on**: US1 OTP endpoints (reuse, not rebuild)

### Tests for User Story 3 ⚠️ WRITE FIRST, FAIL BEFORE IMPLEMENTATION

- [X] T021 [P] [US3] ProvidersService unit spec with mocked JWKS fetch (Google + Apple, kid-miss refetch, iss/aud/exp checks) in src/passenger-auth/providers.service.spec.ts
- [X] T022 [P] [US3] E2E social→restricted→verify→upgrade section in test/passenger-auth.e2e-spec.ts

### Implementation for User Story 3

- [X] T023 [US3] Implement ProvidersService JWKS verification (global fetch, best-effort key cache, transitive jsonwebtoken) in src/passenger-auth/providers.service.ts
- [X] T024 [US3] Implement provider login variant in src/auth/auth.service.ts (verify idToken → link-or-create user + UserAuthProvider row → issue restricted/full session per verification state)
- [X] T025 [US3] Emit provider.link audit, treat unverified provider email as absent, never store/log raw idToken in src/auth/auth.service.ts and src/passenger-auth/providers.service.ts

**Checkpoint**: Social login works end-to-end; restricted token rejected outside profile/OTP routes per contracts

---

## Phase 6: User Story 4 - Profile status and update (Priority: P2)

**Goal**: Signed-in passenger checks completeness and updates name/phone/picture; new phone resets verification and restricts sessions

**Independent Test**: Profile-status reports missingFields/phoneVerified; name update preserves verification; phone change → unverified + restricted + PHONE_CHANGE challenge

**Depends on**: US1 OTP endpoints, US3 restricted-session concept

### Tests for User Story 4 ⚠️ WRITE FIRST, FAIL BEFORE IMPLEMENTATION

- [X] T026 [P] [US4] E2E profile-status/update/phone-change section in test/passenger-auth.e2e-spec.ts
- [X] T027 [P] [US4] Scope-enforcement unit spec (restricted allowed only on profile/OTP routes) for guard/decorator wiring

### Implementation for User Story 4

- [X] T028 [US4] Implement GET /me/profile-status and PATCH /me in src/passenger-auth/passenger-auth.controller.ts (PRD missingFields names, verificationRequired flag)
- [X] T029 [US4] Implement phone-change flow (normalize → global-conflict check → PHONE_UNAVAILABLE non-revealing on conflict → store unverified + open challenge + audit phone.change; sessions restrict via live-state derivation)
- [X] T030 [US4] Enforce full-scope requirement on all non-profile authenticated routes via guard registration in src/auth/guards/jwt-auth.guard.ts (no JWT shape change)

**Checkpoint**: US4 complete; phone change instantly restricts live sessions with no authVersion bump (per research R-05)

---

## Phase 7: User Story 5 - Abuse protection on login and verification (Priority: P3)

**Goal**: Locked throttle budgets enforced everywhere with retryAfter; generic-error probe set green; no secret leakage

**Independent Test**: quickstart.md Scenarios 4–5 — cooldown/429s, ≤5 guesses evaluated per challenge, login buckets bite at 5/phone + 20/IP, probe responses byte-identical, secret scan clean

### Tests for User Story 5 ⚠️ WRITE FIRST, FAIL BEFORE IMPLEMENTATION

- [X] T031 [P] [US5] Throttle + probe-matrix E2E sections (cooldown, send/verify/login budgets, generic-error diff set, 123456/token/password secret scan) in test/passenger-auth.e2e-spec.ts

### Implementation for User Story 5

- [X] T032 [US5] Wire ThrottleService into send-otp/verify-otp paths in src/passenger-auth/otp.service.ts and src/passenger-auth/passenger-auth.controller.ts (60-s cooldown, 3 sends/phone/10 min, 10 verify/challenge/10 min, retryAfter on 429)
- [X] T033 [US5] Wire login throttling into src/auth/auth.service.ts (5 failures/phone + 20/source/15 min, reset phone bucket on success)
- [X] T034 [US5] Harden generic errors (identical bodies/timing class, non-revealing PHONE_UNAVAILABLE) and verify zero code/token/password exposure in responses, logs, and audit metadata

**Checkpoint**: All five stories functional; throttle budgets and error discipline proven by E2E

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Gates, docs, and release readiness

- [X] T035 [P] Run quickstart.md validation Scenarios 1–5 end-to-end against a clean database
- [X] T036 [P] Run pnpm test:cov and close coverage gaps to ≥80% for touched modules
- [X] T037 Run full gate: pnpm lint, pnpm test, pnpm test:e2e (14-test isolation matrix must stay green)
- [X] T038 [P] Regenerate OpenAPI (pnpm docs:generate) and fix any contracts/ drift in specs/002-passenger-auth-flow/contracts/
- [X] T039 Record SMS-provider swap follow-up (code_hash column, R-04) as a tracked note in specs/002-passenger-auth-flow/research.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Stories (Phase 3–7)**: Depend on Foundational; US3 additionally reuses US1 OTP endpoints; US4 reuses US1 OTP + US3 restricted sessions; US5 wires enforcement into US1/US2 paths
- **Polish (Phase 8)**: Depends on all stories complete

### User Story Dependencies

- **US1 (P1)**: After Foundational — no story dependencies; MVP
- **US2 (P1)**: After Foundational — independent of US1 (shares only foundational guard/filter)
- **US3 (P2)**: After Foundational + US1 endpoints (OTP reuse)
- **US4 (P2)**: After Foundational + US1 endpoints + US3 scope concept
- **US5 (P3)**: After Foundational; enforcement lands on US1/US2/US4 paths, verified by its own probe matrix

### Within Each User Story

- Spec-first: test tasks FAIL before implementation tasks begin
- Services before endpoints; endpoints before audit/swagger wiring
- Story checkpoint green before next priority starts

### Parallel Opportunities

- T002 ‖ T003 (baseline vs module shell); T006 ‖ T007 ‖ T010 (helper, throttle, DTOs — different files)
- T011 ‖ T012, T017 ‖ T018, T021 ‖ T022, T026 ‖ T027 (test pairs per story)
- US1 ‖ US2 implementation tracks after Foundational (different files: passenger-auth/* vs auth/*; coordinate on shared e2e file by section)
- T035 ‖ T036 ‖ T038 in Polish (validation, coverage, docs)

---

## Parallel Example: User Story 1

```bash
# Launch US1 tests together (different sections, same spec run):
Task: "OtpService unit spec in src/passenger-auth/otp.service.spec.ts"
Task: "E2E register→verify flow in test/passenger-auth.e2e-spec.ts"

# After T013 lands, controller work unblocks:
Task: "POST /auth/register + OTP endpoints in src/passenger-auth/passenger-auth.controller.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup + Phase 2: Foundational
2. Complete Phase 3: US1 (register + fixed-code OTP verify)
3. **STOP and VALIDATE**: quickstart Scenario 1 green; demo phone registration with `123456`
4. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → migration + RLS check green
2. + US1 → phone registration MVP
3. + US2 → password login (+ PHONE_NOT_VERIFIED routing)
4. + US3 → social login with restricted sessions
5. + US4 → profile completion loop closed
6. + US5 → throttle/error discipline proven; full release

### Parallel Team Strategy

1. Team completes Setup + Foundational together
2. Then: Developer A → US1 + US4 (OTP + profile reuse chain); Developer B → US2 + US5-login; Developer C → US3
3. US5 probe matrix runs last, owned by one developer across all paths

---

## Notes

- [P] = different files, no dependencies; [USn] traces to spec.md stories (US1 P1, US2 P1, US3 P2, US4 P2, US5 P3)
- Every implementation task names its exact file; e2e sections accumulate in the single test/passenger-auth.e2e-spec.ts by story section
- Fixed OTP `123456` via OTP_FIXED_CODE env (default `123456`); never logged, returned, or audited
- Commit after each task; stop at any checkpoint to validate the story independently
