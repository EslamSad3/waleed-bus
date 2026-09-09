# Feature Specification: Passenger Auth Flow

**Feature Branch**: `002-passenger-auth-flow`

**Created**: 2026-09-07

**Status**: Draft

**Input**: User description: "'d:/Eslam/waleed/bus/WalledBus_Mobile_Users_Backend_PRD.md' only auth flow (in the phone verify otp use fixed 123456 number until we decide which sms provider we will use) also use ratelimiting for auth and otp implement #3, #4 and #5 for passenger"

**Scope**: PRD sections #3 (Authentication), #4 (Passenger Phone Verification), #5 (Passenger Profile Completion) — passenger role only. Fleet Owner, Driver, bookings, tracking, and all other PRD sections are out of scope.

## Clarifications

### Session 2026-09-07

- Q: When a passenger with a correct phone and password tries to log in but the phone is not yet verified, what should the system return? → A: Distinct verify-needed code (return a distinct PHONE_NOT_VERIFIED signal so the app can route directly to the verify screen).
- Q: Can the same phone number be registered on more than one account (for example as both a passenger and a driver)? → A: Globally unique (one phone belongs to only one account of any type; reuse is rejected with a non-revealing error).
- Q: Should the one-time-code policy (code lifetime, resend cooldown, and guess limit) be locked as fixed normative values in this spec? → A: Lock standard values (5-minute code lifetime, 60-second resend cooldown, 5 guesses per challenge, then lock).
- Q: What kind of session should a social-login passenger hold while the profile is still incomplete (phone missing or unverified)? → A: Restricted session (valid only for profile-status, profile update, and OTP steps until the phone is verified).
- Q: Should the login and code-send rate-limit thresholds be locked as fixed normative values in this spec? → A: Lock concrete thresholds (login: 5 failures per phone and 20 per source per 15 min; code send: 3 per phone per 10 min; verify: 10 requests per challenge per 10 min).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Register with phone, password, and OTP verification (Priority: P1)

A new passenger creates an account with name, phone number, and password, receives a verification code, enters it, and the account becomes active and verified.

**Why this priority**: This is the primary account-creation path. Without it no passenger can use the app with phone credentials.

**Independent Test**: Can be fully tested by submitting a name, phone, and password, then verifying the phone with the code, and confirming the account is active and can start an authenticated session. Delivers a usable passenger account.

**Acceptance Scenarios**:

1. **Given** a new phone number never registered, **When** the passenger submits name, phone, and password, **Then** a verification code challenge is created for that phone and the account is pending verification.
2. **Given** a pending-verification account with an active code challenge, **When** the passenger submits the correct code `123456`, **Then** the phone becomes verified, the account becomes active, and an authenticated session starts.
3. **Given** a pending-verification account, **When** the passenger submits a wrong code, **Then** verification fails with a non-revealing error and the phone stays unverified.

---

### User Story 2 - Log in with phone and password (Priority: P1)

An existing passenger with a verified phone and password logs in and receives an authenticated session.

**Why this priority**: Returning users need this on every session; it is equally critical as registration.

**Independent Test**: Can be fully tested by logging in with a previously registered verified phone and password and confirming access to own profile data. Delivers returning-user access.

**Acceptance Scenarios**:

1. **Given** a registered passenger with verified phone and known password, **When** the passenger logs in with correct phone and password as type PASSENGER, **Then** an authenticated session starts.
2. **Given** any login attempt with wrong phone, wrong password, nonexistent account, or wrong account type, **When** login is submitted, **Then** the same generic authentication failure is returned with no indication of which part was wrong.
3. **Given** a passenger whose phone is not yet verified, **When** the passenger attempts password login with correct credentials, **Then** login returns a distinct verification-needed signal (not the generic failure) so the app routes directly to phone verification; wrong credentials still return the generic failure.

---

### User Story 3 - Log in or register with Google or Apple and verify phone (Priority: P2)

A passenger authenticates with a Google or Apple identity. If the app has no verified phone for this passenger, the passenger provides a phone number, verifies it with the code, and the profile becomes complete.

**Why this priority**: Social login is the second account-creation method in the PRD and must enforce the mandatory verified-phone rule.

**Independent Test**: Can be fully tested by authenticating with a provider identity, entering a phone number when prompted, verifying the code, and confirming the profile is complete. Delivers social-login access with a verified phone.

**Acceptance Scenarios**:

1. **Given** a Google or Apple identity with no existing passenger record, **When** the passenger authenticates with the provider, **Then** a passenger record is created/linked, a restricted session is issued (valid only for profile-status, profile update, and OTP steps), and the passenger is asked to complete the missing phone step.
2. **Given** a social passenger with missing or unverified phone, **When** the passenger submits a phone number, **Then** a verification code challenge is created for that phone.
3. **Given** a social passenger with an active code challenge, **When** the passenger submits the correct code `123456`, **Then** the phone becomes verified, the profile becomes complete, and the restricted session is upgraded to a full authenticated session.
4. **Given** a social passenger whose phone is already verified, **When** the passenger authenticates with the provider, **Then** an authenticated session starts without asking for the phone again.

---

### User Story 4 - Check profile completeness and update profile (Priority: P2)

A signed-in passenger checks what is missing from the profile (e.g., phone number, phone verification) and updates name or phone. Entering a new phone opens a 60-second verification window for the new number while the verified number keeps working and the session stays full; an unverified change expires without touching the account.

**Why this priority**: This is PRD #5 — the mechanism that closes the loop for social accounts and phone changes.

**Independent Test**: Can be fully tested by querying profile status, updating the phone, and confirming the old number stays active with the new number pending until the code is verified (or the window expires, dropping the request). Delivers a complete, trustworthy profile.

**Acceptance Scenarios**:

1. **Given** a signed-in social passenger with unverified phone, **When** the passenger checks profile status, **Then** the status reports profile incomplete, names the missing phone field, and reports phone unverified.
2. **Given** a signed-in passenger, **When** the passenger updates the name, **Then** the name is saved and verification state is unchanged.
3. **Given** a signed-in passenger with a verified phone, **When** the passenger changes to a new phone number, **Then** the verified phone stays active, the new phone is reported pending with `expiresInSeconds: 60`, the session keeps full scope, and verifying within the window swaps the new number in with no re-login.
4. **Given** a pending phone change, **When** the 60-second window passes without verification, **Then** the request is dropped, the verified phone and the session are untouched, and a new change may be requested.

---

### User Story 5 - Abuse protection on login and verification (Priority: P3)

The system slows down and blocks abusive login and code-guessing traffic so attackers cannot enumerate accounts or brute-force codes, while legitimate passengers see clear retry guidance.

**Why this priority**: Security cross-cutting requirement explicitly requested (rate limiting for auth and OTP) plus PRD-mandated OTP safeguards (expiration, cooldown, attempt limit, one-time use).

**Independent Test**: Can be fully tested by exceeding send/resend, verify-attempt, and login-attempt thresholds from a single source and confirming further attempts are temporarily rejected with retry guidance, then allowed again after the window. Delivers brute-force resistance.

**Acceptance Scenarios**:

1. **Given** a phone with a recently sent code, **When** the passenger requests another code before the resend cooldown elapses, **Then** the request is rejected with retry-after guidance and no new challenge is created.
2. **Given** an active code challenge, **When** the passenger submits wrong codes beyond the attempt limit, **Then** the challenge is locked/expired and further guesses are rejected until a new code is requested.
3. **Given** repeated failed login attempts from the same source, **When** the rate limit threshold is exceeded, **Then** further login attempts are temporarily rejected with retry guidance, without revealing whether any phone exists.

---

### Edge Cases

- What happens when the code expires before the passenger submits it? Verification fails with an expired-code error and the passenger can request a new code after cooldown.
- How does the system handle reuse of an already-consumed code? The code is single-use; replay is rejected.
- How does the system handle concurrent verify requests with the same code? Only one succeeds; the others are rejected as already-used.
- What happens when a passenger tries to register a phone already tied to a verified account (of any type, given global uniqueness)? The response does not reveal existence; behavior follows the generic-error rule (no account-enumeration oracle).
- What happens when a provider identity supplies no usable phone number? The passenger is routed through the complete-profile flow (enter phone → send code → verify).
- What happens when a passenger changes phone to a number already verified on another account? The change is rejected with a non-revealing error that does not disclose the other account.
- How does the system handle login with a mismatched account type (e.g., driver phone used as PASSENGER)? The same generic authentication failure is returned; the real account type is never disclosed.
- What happens when rate limits are hit during legitimate use (e.g., poor network retries)? The passenger receives retry-after guidance and can succeed after waiting; limits reset after the window.
- How does the system handle a restricted (incomplete-profile) session used against other passenger operations? The call is rejected; only profile-status, profile update, and OTP steps are permitted until verification completes.
- What happens when the fixed temporary code `123456` is submitted after the SMS provider is integrated later? This spec documents `123456` as temporary; provider-issued random codes replace it without changing the flows defined here.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow a new passenger to register with name, phone number, and password, creating the account in a pending-verification state until the phone is verified.
- **FR-002**: System MUST require phone verification before a phone-registered passenger account becomes fully active; a password login with correct credentials on an unverified phone MUST return a distinct verification-needed signal (routing the app to verification) rather than the generic authentication failure.
- **FR-003**: System MUST allow a passenger to log in with phone number and password under account type PASSENGER and start an authenticated session on success.
- **FR-004**: System MUST allow a passenger to authenticate with a Google or Apple provider identity and link or create the passenger record for that provider identity.
- **FR-005**: System MUST treat the application phone number as mandatory for every passenger, including provider-authenticated passengers, and MUST keep the profile incomplete until a phone is verified.
- **FR-006**: System MUST create a phone verification challenge when a passenger registers, completes a social profile with a phone, or enters a new phone number.
- **FR-007**: System MUST accept the fixed verification code `123456` as the valid code for any active challenge until an SMS provider is selected and integrated (temporary behavior).
- **FR-008**: System MUST mark the phone as verified only after successful code verification, and MUST record the verification event.
- **FR-009**: Verification codes MUST be single-use; a consumed code MUST be rejected on replay.
- **FR-010**: Verification challenges MUST expire after creation — 5 minutes for registration/profile challenges, 60 seconds for phone-change (`PHONE_CHANGE`) challenges; expired challenges MUST be rejected and require requesting a new code.
- **FR-011**: Code resend requests MUST be subject to a 60-second cooldown period; requests inside the cooldown MUST be rejected with retry-after guidance without creating a new challenge. A resend past the cooldown MUST preserve the live challenge's account binding (purpose/`userId`), so verification still stamps the right user.
- **FR-012**: Code verification guesses MUST be limited to 5 per challenge; the 6th and subsequent guesses MUST lock or expire the challenge.
- **FR-013**: System MUST NEVER return, echo, or otherwise disclose the verification code in any response, log, or error available to clients.
- **FR-014**: All authentication and verification failure responses MUST be generic and MUST NOT reveal whether a phone exists, whether an account exists, the account's role/type, which credential was wrong, or whether a social identity is linked. The sole exception is the verification-needed signal for correct credentials on an unverified phone (see FR-002).
- **FR-015**: Login attempts (phone+password and provider) MUST be rate-limited: at most 5 failed attempts per targeted phone per 15 minutes and at most 20 failed attempts per source per 15 minutes; exceeding either threshold MUST temporarily reject further login attempts with retry-after guidance.
- **FR-016**: Code send MUST be limited to 3 sends per phone per 10 minutes and code verify to 10 requests per challenge per 10 minutes (in addition to the 5-guess lock in FR-012); exceeding either threshold MUST temporarily reject further attempts of that operation with retry-after guidance.
- **FR-017**: System MUST expose the signed-in passenger's profile completeness status, including which fields are missing and whether the phone is verified.
- **FR-018**: System MUST allow a signed-in passenger to update name and phone number; a newly entered phone number MUST stay pending — the verified number untouched and the session unrevoked — until successfully verified, MUST trigger a new verification challenge with a 60-second window reported as `expiresInSeconds`, and MUST be dropped on expiry. A further change MUST wait out the active window (`429` with `retryAfter`); phone changes are additionally rate-limited to 3 per user per 10 minutes.
- **FR-019**: Phone-change requests MUST NOT downgrade live sessions: the verified number stays active until the new number is verified. (Never-verified accounts still hold only restricted scope per FR-022.)
- **FR-022**: A passenger whose profile is incomplete (phone missing or unverified) MUST hold only a restricted session valid for profile-status, profile update, and OTP steps; any other passenger operation with that session MUST be rejected. The restricted session MUST be upgraded to a full session upon successful phone verification.
- **FR-020**: Out of scope: Fleet Owner and Driver account creation/login management, bookings, trips, tracking, sharing, QR, ratings, reports, notifications, and payment flows. Only PASSENGER login types and passenger phone/profile flows are in scope.
- **FR-021**: Phone numbers MUST be globally unique across all accounts of any type; registering or changing to a phone already tied to any other account MUST be rejected with a non-revealing error that discloses no information about the existing account.

### Key Entities

- **Passenger Account**: A person using the mobile app to book trips; attributes include name, phone number (globally unique across all account types), phone verification state, password credential (for phone login), profile picture (optional), account status, and timestamps.
- **Phone Verification Challenge**: A time-bound, single-use verification demand tied to one phone number; attributes include target phone, creation and expiration time, attempt count, consumption state, and resend-cooldown state. The code value is never exposed.
- **Social Identity Link**: The binding between a passenger account and a Google or Apple provider identity; attributes include provider name and provider-side user reference.
- **Authenticated Session**: The result of a successful login or verification that authorizes the passenger to access their own profile and verification operations until it expires or is revoked.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: New passengers can complete phone registration (submit details + verify code) in under 3 minutes on a normal mobile connection.
- **SC-002**: At least 95% of correct code submissions on the first attempt result in a verified phone and active session.
- **SC-003**: Returning passengers with correct credentials can complete phone+password login in under 30 seconds.
- **SC-004**: At least 95% of social-login passengers missing a phone reach a complete verified profile after entering a phone and verifying, without contacting support.
- **SC-005**: 100% of failed login, code-send, and code-verify responses disclose no account existence, role, or credential-correctness information when reviewed against a probe set (existing vs. nonexistent phones, right vs. wrong passwords, mismatched account types); the only permitted distinction is the verification-needed signal for correct credentials on an unverified phone.
- **SC-006**: Automated rapid-fire guessing (e.g., 50 wrong-code attempts in quick succession) is blocked by the 5-guess attempt limit and rate limiting such that no more than 5 guesses are evaluated per challenge, and legitimate retry succeeds after the cooldown/window.
- **SC-007**: Zero verification codes are observable in any client-facing response, error message, or client-accessible log during verification testing.
- **SC-008**: Expired codes, replayed codes, premature resends, and rate-limited send/login/verify attempts are rejected in 100% of test cases with actionable retry guidance.

## Assumptions

- Temporary fixed code: `123456` is accepted for every active challenge until an SMS provider is chosen; no real SMS is sent in this phase. Random provider-issued codes will replace it later without changing these flows.
- Normative OTP policy (locked 2026-09-07): code lifetime 5 minutes, resend cooldown 60 seconds, maximum 5 verification guesses per challenge, single-use codes.
- Normative rate-limit posture (locked 2026-09-07): login 5 failures per phone and 20 per source per 15 min; code send 3 per phone per 10 min; code verify 10 requests per challenge per 10 min; all rejections temporary with retry-after guidance.
- Phone format follows the PRD's Egyptian mobile convention (e.g., `01000000000`); exact normalization and validation rules are defined in planning.
- Password policy default: minimum 8 characters; hashing and session mechanics follow platform security policy and are defined in planning, not here.
- Provider login relies on verifiable Google/Apple identity tokens; token validation details are defined in planning.
- A passenger login with correct credentials but an unverified phone receives the distinct verification-needed signal (per FR-002); the client routes the passenger to verification. All other failed logins receive the generic failure.
- PRD API contracts and error codes (e.g., `AUTHENTICATION_FAILED`, `OTP_INVALID`, `OTP_EXPIRED`, `OTP_RATE_LIMITED`) are honored in planning; this spec describes behavior, not wire format.
- Only the passenger role is in scope; Fleet Owner and Driver flows reuse the generic-error principle but are otherwise excluded from this feature.
