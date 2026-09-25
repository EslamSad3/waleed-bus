import request from 'supertest';
import { createServer, type Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration.js';
import type { TestApp } from './helpers/app.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';

// Provider verification points at a local JWKS server (real RSA crypto,
// no external network). Set before the app boots and reads config.
if (!process.env.GOOGLE_CLIENT_ID)
  process.env.GOOGLE_CLIENT_ID = 'e2e-google-client';
if (!process.env.GOOGLE_JWKS_URI)
  process.env.GOOGLE_JWKS_URI = 'http://127.0.0.1:4599/certs';

/**
 * Passenger auth flow (spec 002). Sections accumulate per user story:
 * US1 register+OTP, US2 phone login, US3 social, US4 profile, US5 throttling.
 */
describe('Passenger auth (e2e)', () => {
  let t: TestApp;
  let jwksServer: Server;
  let googleJwk: Record<string, unknown>;
  let googlePrivatePem: string;

  const register = (
    phoneNumber: string,
    password = 'Passw0rd!123',
    name = 'Ahmed',
  ) =>
    request(t.app.getHttpServer())
      .post('/auth/register')
      .send({ name, phoneNumber, password });
  const sendOtp = (phoneNumber: string) =>
    request(t.app.getHttpServer())
      .post('/auth/phone/send-otp')
      .send({ phoneNumber });
  const verifyOtp = (phoneNumber: string, otp: string) =>
    request(t.app.getHttpServer())
      .post('/auth/phone/verify-otp')
      .send({ phoneNumber, otp });
  const providerLogin = (provider: string, idToken: string) =>
    request(t.app.getHttpServer())
      .post('/auth/login')
      .send({ loginType: 'PASSENGER', provider, idToken });

  async function googleToken(
    sub: string,
    email = `${sub}@example.com`,
  ): Promise<string> {
    const jwtService = t.app.get(JwtService);
    return jwtService.signAsync(
      {
        iss: 'https://accounts.google.com',
        aud: 'e2e-google-client',
        sub,
        email,
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 300,
      } as never,
      {
        secret: googlePrivatePem,
        algorithm: 'RS256',
        keyid: 'e2e-rsa-kid',
      } as never,
    );
  }

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(loadConfig(process.env).database.systemUrl);
  });

  beforeAll(async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    googleJwk = {
      ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
      kid: 'e2e-rsa-kid',
      use: 'sig',
    };
    googlePrivatePem = privateKey.export({
      format: 'pem',
      type: 'pkcs8',
    }) as string;
    jwksServer = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [googleJwk] }));
    });
    await new Promise<void>((resolve) =>
      jwksServer.listen(4599, '127.0.0.1', resolve),
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => jwksServer?.close(() => resolve()));
    await t?.close();
  });

  describe('US1 - register with phone, password, OTP', () => {
    it('registers a pending passenger and opens a challenge', async () => {
      const res = await register('01000000001').expect(201);
      expect(res.body).toEqual({
        statusCode: 201,
        data: { verificationRequired: true, phoneNumber: '01000000001' },
      });
      const user = await t.system.user.findUnique({
        where: { phoneNumber: '01000000001' },
      });
      expect(user).toMatchObject({
        name: 'Ahmed',
        phoneVerifiedAt: null,
        isActive: true,
      });
      expect(user?.passwordHash).toEqual(expect.any(String));
      const roles = await t.system.userRole.findMany({
        where: { userId: user!.id },
        include: { role: true },
      });
      expect(roles.map((r) => r.role.slug)).toContain('passenger');
    });

    it('sends the OTP challenge', async () => {
      await register('01000000002').expect(201);
      // Registration already opened a challenge; simulate the cooldown
      // passing so send-otp exercises the refresh path.
      await t.system.phoneVerificationChallenge.deleteMany({
        where: { phoneNumber: '01000000002' },
      });
      const res = await sendOtp('01000000002').expect(201);
      expect(res.body).toEqual({
        statusCode: 201,
        data: { sent: true, expiresInSeconds: 300 },
      });
    });

    it('verifies the fixed code and activates the phone', async () => {
      await register('01000000003').expect(201);
      const res = await verifyOtp('01000000003', '123456').expect(200);
      expect(res.body).toEqual({
        statusCode: 200,
        data: { success: true, phoneVerified: true },
      });
      const user = await t.system.user.findUnique({
        where: { phoneNumber: '01000000003' },
      });
      expect(user?.phoneVerifiedAt).toBeInstanceOf(Date);
    });

    it('rejects a wrong code without revealing anything', async () => {
      await register('01000000004').expect(201);
      const res = await verifyOtp('01000000004', '000000').expect(404);
      expect(res.body).toMatchObject({ statusCode: 404, code: 'OTP_INVALID' });
      expect(res.body).not.toHaveProperty('details');
      const user = await t.system.user.findUnique({
        where: { phoneNumber: '01000000004' },
      });
      expect(user?.phoneVerifiedAt).toBeNull();
    });

    it('rejects replay of a consumed code', async () => {
      await register('01000000005').expect(201);
      await verifyOtp('01000000005', '123456').expect(200);
      await verifyOtp('01000000005', '123456').expect(404);
    });

    it('keeps the registration binding across a resend so login works after verify', async () => {
      await register('01000000071').expect(201);
      // Resend past the cooldown, then verify: the resend must not orphan
      // the challenge or verification stamps nobody and login 403s.
      await t.system.phoneVerificationChallenge.update({
        where: { phoneNumber: '01000000071' },
        data: { lastSentAt: new Date(Date.now() - 61_000) },
      });
      const resend = await sendOtp('01000000071').expect(201);
      expect(resend.body.data).toMatchObject({ sent: true });
      await verifyOtp('01000000071', '123456').expect(200);
      await request(t.app.getHttpServer())
        .post('/auth/login')
        .send({
          loginType: 'PASSENGER',
          phone: '01000000071',
          password: 'Passw0rd!123',
        })
        .expect(201);
    });

    it('returns an identical response when the phone is already registered (no oracle)', async () => {
      await register('01000000006').expect(201);
      const res = await register('01000000006').expect(201);
      expect(res.body).toEqual({
        statusCode: 201,
        data: { verificationRequired: true, phoneNumber: '01000000006' },
      });
      const count = await t.system.user.count({
        where: { phoneNumber: '01000000006' },
      });
      expect(count).toBe(1);
    });

    it('validates register payloads with 400, never 500', async () => {
      const badPhone = await register('not-a-phone').expect(400);
      expect(badPhone.body).toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
      });
      await register('01000000007', 'short').expect(400);
      await request(t.app.getHttpServer())
        .post('/auth/register')
        .send({})
        .expect(400);
    });

    it('never discloses the code in any response', async () => {
      await register('01000000008').expect(201);
      await t.system.phoneVerificationChallenge.deleteMany({
        where: { phoneNumber: '01000000008' },
      });
      const send = await sendOtp('01000000008').expect(201);
      const bad = await verifyOtp('01000000008', '000000').expect(404);
      for (const body of [send.body, bad.body]) {
        expect(JSON.stringify(body)).not.toContain('123456');
      }
    });
  });

  describe('US2 - login with phone and password', () => {
    const phoneLogin = (phone: string, password: string) =>
      request(t.app.getHttpServer())
        .post('/auth/login')
        .send({ loginType: 'PASSENGER', phone, password });

    it('issues a passenger token pair for verified credentials', async () => {
      await register('01000000011').expect(201);
      await verifyOtp('01000000011', '123456').expect(200);
      const res = await phoneLogin('01000000011', 'Passw0rd!123').expect(201);
      expect(Object.keys(res.body.data)).toEqual(
        expect.arrayContaining(['accessToken', 'refreshToken']),
      );
      const payload = JSON.parse(
        Buffer.from(
          res.body.data.accessToken.split('.')[1],
          'base64url',
        ).toString(),
      );
      expect(payload).toMatchObject({ app_role: 'passenger' });
      expect(JSON.stringify(res.body.data)).not.toContain('passenger');
    });

    it('returns PHONE_NOT_VERIFIED for correct credentials on an unverified phone', async () => {
      await register('01000000012').expect(201);
      const res = await phoneLogin('01000000012', 'Passw0rd!123').expect(403);
      expect(res.body).toMatchObject({
        statusCode: 403,
        code: 'PHONE_NOT_VERIFIED',
        details: { phoneNumber: '01000000012' },
      });
    });

    it('returns byte-identical generic failures for wrong, unknown, and mismatched credentials', async () => {
      await register('01000000013').expect(201);
      await verifyOtp('01000000013', '123456').expect(200);
      const wrong = await phoneLogin('01000000013', 'Wrongpass!123').expect(
        401,
      );
      const unknown = await phoneLogin('01000000099', 'Passw0rd!123').expect(
        401,
      );
      // FLEET_OWNER never self-provisions, so it stays the mismatch probe
      // (spec 003 US5: DRIVER logins provision a personal fleet instead).
      const badType = await request(t.app.getHttpServer())
        .post('/auth/login')
        .send({
          loginType: 'FLEET_OWNER',
          phone: '01000000013',
          password: 'Passw0rd!123',
        })
        .expect(401);
      for (const res of [wrong, unknown, badType]) {
        expect(res.body).toEqual({
          statusCode: 401,
          code: 'AUTHENTICATION_FAILED',
          message: 'Unable to authenticate with the provided credentials.',
        });
      }
    });

    it('rejects malformed passenger login payloads with 400', async () => {
      await request(t.app.getHttpServer())
        .post('/auth/login')
        .send({ loginType: 'PASSENGER', phone: '01000000011' })
        .expect(400);
    });
  });

  describe('US3 - Google login with phone completion', () => {
    it('creates and links a passenger on first Google login (restricted session)', async () => {
      const res = await providerLogin(
        'GOOGLE',
        await googleToken('google-e2e-1'),
      ).expect(201);
      expect(res.body.data).toMatchObject({ profileComplete: false });
      expect(res.body.data.accessToken).toEqual(expect.any(String));
      const link = await t.system.userAuthProvider.findFirst({
        where: { provider: 'GOOGLE', providerUserId: 'google-e2e-1' },
        include: { user: true },
      });
      expect(link?.user.phoneNumber).toBeNull();
      expect(link?.user.email).toBe('google-e2e-1@example.com');
    });

    it('reuses the linked passenger on repeat Google login (no duplicates)', async () => {
      await providerLogin('GOOGLE', await googleToken('google-e2e-2')).expect(
        201,
      );
      await providerLogin('GOOGLE', await googleToken('google-e2e-2')).expect(
        201,
      );
      expect(
        await t.system.userAuthProvider.count({
          where: { providerUserId: 'google-e2e-2' },
        }),
      ).toBe(1);
    });

    it('rejects tampered provider tokens with the generic 401', async () => {
      const valid = await googleToken('google-e2e-3');
      const parts = valid.split('.');
      const tampered = `${parts[0]}.${parts[1]}-tampered.${parts[2]}`;
      const res = await providerLogin('GOOGLE', tampered).expect(401);
      expect(res.body).toEqual({
        statusCode: 401,
        code: 'AUTHENTICATION_FAILED',
        message: 'Unable to authenticate with the provided credentials.',
      });
    });

    it('restricts the incomplete session to profile/OTP routes', async () => {
      const login = await providerLogin(
        'GOOGLE',
        await googleToken('google-e2e-4'),
      ).expect(201);
      const token = login.body.data.accessToken as string;
      const me = await request(t.app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(me.body).toMatchObject({ code: 'PROFILE_INCOMPLETE' });
    });

    it('upgrades the same session to full after phone verification', async () => {
      const login = await providerLogin(
        'GOOGLE',
        await googleToken('google-e2e-5'),
      ).expect(201);
      const token = login.body.data.accessToken as string;
      const link = await t.system.userAuthProvider.findFirst({
        where: { providerUserId: 'google-e2e-5' },
      });
      // US4's PATCH /me binds phone→user before send-otp; simulate that binding here.
      await sendOtp('01000000021').expect(201);
      await t.system.phoneVerificationChallenge.update({
        where: { phoneNumber: '01000000021' },
        data: { userId: link!.userId },
      });
      await verifyOtp('01000000021', '123456').expect(200);
      const me = await request(t.app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(me.body.data).toMatchObject({ appRole: 'passenger' });
    });
  });

  describe('US4 - profile status and update', () => {
    async function verifiedToken(phone: string): Promise<string> {
      await register(phone).expect(201);
      await verifyOtp(phone, '123456').expect(200);
      const login = await request(t.app.getHttpServer())
        .post('/auth/login')
        .send({ loginType: 'PASSENGER', phone, password: 'Passw0rd!123' })
        .expect(201);
      return login.body.data.accessToken as string;
    }

    const authed = (token?: string) => {
      const req = token ? { Authorization: `Bearer ${token}` } : {};
      return req;
    };

    it('reports a complete profile for verified passengers', async () => {
      const token = await verifiedToken('01000000031');
      const res = await request(t.app.getHttpServer())
        .get('/me/profile-status')
        .set(authed(token))
        .expect(200);
      expect(res.body).toEqual({
        statusCode: 200,
        data: {
          profileComplete: true,
          missingFields: [],
          phoneVerified: true,
          pendingPhoneNumber: null,
          expiresInSeconds: null,
          effectiveMaxBookingSeats: 5,
        },
      });
    });

    it('reports incompleteness on a restricted session and requires auth', async () => {
      await request(t.app.getHttpServer())
        .get('/me/profile-status')
        .expect(401);
      const login = await providerLogin(
        'GOOGLE',
        await googleToken('google-e2e-6'),
      ).expect(201);
      const res = await request(t.app.getHttpServer())
        .get('/me/profile-status')
        .set(authed(login.body.data.accessToken as string))
        .expect(200);
      expect(res.body.data).toMatchObject({
        profileComplete: false,
        phoneVerified: false,
      });
      expect(res.body.data.missingFields).toContain('phoneNumber');
    });

    it('updates the name without touching verification', async () => {
      const token = await verifiedToken('01000000032');
      const res = await request(t.app.getHttpServer())
        .patch('/me')
        .set(authed(token))
        .send({ name: 'New Name' })
        .expect(200);
      expect(res.body.data).toMatchObject({
        name: 'New Name',
        phoneVerified: true,
        effectiveMaxBookingSeats: 5,
      });
    });

    it('holds the verified phone pending verification and swaps on verify', async () => {
      const token = await verifiedToken('01000000033');
      const changed = await request(t.app.getHttpServer())
        .patch('/me')
        .set(authed(token))
        .send({ phoneNumber: '01000000034' })
        .expect(200);
      expect(changed.body.data).toMatchObject({
        // Old phone stays active until the new one is verified.
        phoneNumber: '01000000033',
        phoneVerified: true,
        verificationRequired: true,
        sent: true,
        pendingPhoneNumber: '01000000034',
        expiresInSeconds: 60,
      });
      // The live session is NOT restricted: the verified phone still works…
      await request(t.app.getHttpServer())
        .get('/auth/me')
        .set(authed(token))
        .expect(200);
      const status = await request(t.app.getHttpServer())
        .get('/me/profile-status')
        .set(authed(token))
        .expect(200);
      expect(status.body.data).toMatchObject({
        profileComplete: true,
        phoneVerified: true,
        pendingPhoneNumber: '01000000034',
      });
      expect(status.body.data.expiresInSeconds).toEqual(expect.any(Number));
      // …and verifying the new number swaps it in with no re-login.
      await verifyOtp('01000000034', '123456').expect(200);
      const user = await t.system.user.findUnique({
        where: { phoneNumber: '01000000034' },
      });
      expect(user?.phoneVerifiedAt).toBeInstanceOf(Date);
      const cleared = await request(t.app.getHttpServer())
        .get('/me/profile-status')
        .set(authed(token))
        .expect(200);
      expect(cleared.body.data).toMatchObject({ pendingPhoneNumber: null });
      await request(t.app.getHttpServer())
        .get('/auth/me')
        .set(authed(token))
        .expect(200);
    });

    it('send-otp inside the pending window cools down without touching the binding', async () => {
      const token = await verifiedToken('01000000072');
      await request(t.app.getHttpServer())
        .patch('/me')
        .set(authed(token))
        .send({ phoneNumber: '01000000073' })
        .expect(200);
      // A separate send step right after the update hits the resend cooldown
      // (the update already sent it) and leaves the pending binding intact.
      const resend = await sendOtp('01000000073').expect(429);
      expect(resend.body).toMatchObject({
        statusCode: 429,
        code: 'OTP_RATE_LIMITED',
        details: { scope: 'resend-cooldown' },
      });
      await verifyOtp('01000000073', '123456').expect(200);
      const user = await t.system.user.findUnique({
        where: { phoneNumber: '01000000073' },
      });
      expect(user?.phoneVerifiedAt).toBeInstanceOf(Date);
      await request(t.app.getHttpServer())
        .post('/auth/login')
        .send({
          loginType: 'PASSENGER',
          phone: '01000000073',
          password: 'Passw0rd!123',
        })
        .expect(201);
    });

    it('rejects a second phone change while one is pending', async () => {
      const token = await verifiedToken('01000000051');
      await request(t.app.getHttpServer())
        .patch('/me')
        .set(authed(token))
        .send({ phoneNumber: '01000000052' })
        .expect(200);
      const res = await request(t.app.getHttpServer())
        .patch('/me')
        .set(authed(token))
        .send({ phoneNumber: '01000000053' })
        .expect(429);
      expect(res.body).toMatchObject({
        statusCode: 429,
        code: 'OTP_RATE_LIMITED',
        details: { scope: 'phone-change' },
      });
      expect(res.body.retryAfter).toEqual(expect.any(Number));
      // The first pending change is untouched and the old phone still works.
      const status = await request(t.app.getHttpServer())
        .get('/me/profile-status')
        .set(authed(token))
        .expect(200);
      expect(status.body.data).toMatchObject({
        pendingPhoneNumber: '01000000052',
      });
      await request(t.app.getHttpServer())
        .get('/auth/me')
        .set(authed(token))
        .expect(200);
    });

    it('treats re-saving the same pending number as the send step (no separate send-otp)', async () => {
      const token = await verifiedToken('01000000065');
      const first = await request(t.app.getHttpServer())
        .patch('/me')
        .set(authed(token))
        .send({ phoneNumber: '01000000066' })
        .expect(200);
      expect(first.body.data).toMatchObject({
        sent: true,
        expiresInSeconds: 60,
      });
      // Saving the same number again within the window re-reports the pending
      // send (remaining window) instead of throttling — the update endpoint IS
      // the send-otp step for this flow, so the client never calls send-otp.
      const second = await request(t.app.getHttpServer())
        .patch('/me')
        .set(authed(token))
        .send({ phoneNumber: '01000000066' })
        .expect(200);
      expect(second.body.data).toMatchObject({
        phoneNumber: '01000000065',
        phoneVerified: true,
        verificationRequired: true,
        sent: false,
        pendingPhoneNumber: '01000000066',
      });
      const remaining = second.body.data.expiresInSeconds as number;
      expect(remaining).toEqual(expect.any(Number));
      expect(remaining).toBeLessThanOrEqual(60);
      expect(remaining).toBeGreaterThan(0);
      // Straight to verify — no send-otp call in between.
      await verifyOtp('01000000066', '123456').expect(200);
      const user = await t.system.user.findUnique({
        where: { phoneNumber: '01000000066' },
      });
      expect(user?.phoneVerifiedAt).toBeInstanceOf(Date);
    });

    it('drops an unverified phone change after expiry and keeps the session', async () => {
      const token = await verifiedToken('01000000054');
      await request(t.app.getHttpServer())
        .patch('/me')
        .set(authed(token))
        .send({ phoneNumber: '01000000055' })
        .expect(200);
      // Simulate the 60s window passing without verification.
      await t.system.phoneVerificationChallenge.update({
        where: { phoneNumber: '01000000055' },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await verifyOtp('01000000055', '123456').expect(410);
      const status = await request(t.app.getHttpServer())
        .get('/me/profile-status')
        .set(authed(token))
        .expect(200);
      expect(status.body.data).toMatchObject({
        profileComplete: true,
        phoneVerified: true,
        pendingPhoneNumber: null,
      });
      // Old verified phone is intact, the session never dropped…
      const user = await t.system.user.findUnique({
        where: { phoneNumber: '01000000054' },
      });
      expect(user?.phoneVerifiedAt).toBeInstanceOf(Date);
      await request(t.app.getHttpServer())
        .get('/auth/me')
        .set(authed(token))
        .expect(200);
      // …and a fresh change is allowed once the window has passed.
      const retry = await request(t.app.getHttpServer())
        .patch('/me')
        .set(authed(token))
        .send({ phoneNumber: '01000000056' })
        .expect(200);
      expect(retry.body.data).toMatchObject({
        verificationRequired: true,
        pendingPhoneNumber: '01000000056',
        expiresInSeconds: 60,
      });
    });

    it('rejects a phone taken by another account without disclosure', async () => {
      const token = await verifiedToken('01000000035');
      await register('01000000036').expect(201);
      const res = await request(t.app.getHttpServer())
        .patch('/me')
        .set(authed(token))
        .send({ phoneNumber: '01000000036' })
        .expect(409);
      expect(res.body).toEqual({
        statusCode: 409,
        code: 'PHONE_UNAVAILABLE',
        message: 'Unable to complete this update.',
      });
      // The active phone is untouched and the session stays full.
      const status = await request(t.app.getHttpServer())
        .get('/me/profile-status')
        .set(authed(token))
        .expect(200);
      expect(status.body.data).toMatchObject({
        phoneVerified: true,
        pendingPhoneNumber: null,
      });
      await request(t.app.getHttpServer())
        .get('/auth/me')
        .set(authed(token))
        .expect(200);
    });

    it('rejects verification when the pending number was taken meanwhile', async () => {
      const token = await verifiedToken('01000000057');
      await request(t.app.getHttpServer())
        .patch('/me')
        .set(authed(token))
        .send({ phoneNumber: '01000000058' })
        .expect(200);
      // Another account grabs the number before the owner verifies it.
      await register('01000000058').expect(201);
      const res = await verifyOtp('01000000058', '123456').expect(409);
      expect(res.body).toEqual({
        statusCode: 409,
        code: 'PHONE_UNAVAILABLE',
        message: 'Unable to complete this update.',
      });
      // The owner keeps the old verified phone and a full session.
      const status = await request(t.app.getHttpServer())
        .get('/me/profile-status')
        .set(authed(token))
        .expect(200);
      expect(status.body.data).toMatchObject({
        phoneVerified: true,
        pendingPhoneNumber: null,
      });
      await request(t.app.getHttpServer())
        .get('/auth/me')
        .set(authed(token))
        .expect(200);
    });

    it('rate-limits phone changes per user: 3 per 10 minutes', async () => {
      const token = await verifiedToken('01000000059');
      const phones = [
        '01000000061',
        '01000000062',
        '01000000063',
        '01000000064',
      ];
      for (const phone of phones.slice(0, 3)) {
        await request(t.app.getHttpServer())
          .patch('/me')
          .set(authed(token))
          .send({ phoneNumber: phone })
          .expect(200);
        // Let each pending change expire so the next request is a new attempt.
        await t.system.phoneVerificationChallenge.update({
          where: { phoneNumber: phone },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
      }
      const res = await request(t.app.getHttpServer())
        .patch('/me')
        .set(authed(token))
        .send({ phoneNumber: phones[3] })
        .expect(429);
      expect(res.body).toMatchObject({
        statusCode: 429,
        code: 'OTP_RATE_LIMITED',
        details: { scope: 'phone-change' },
      });
      expect(res.body.retryAfter).toEqual(expect.any(Number));
    });

    it('validates profile updates with 400', async () => {
      const token = await verifiedToken('01000000037');
      await request(t.app.getHttpServer())
        .patch('/me')
        .set(authed(token))
        .send({ phoneNumber: 'bad' })
        .expect(400);
      await request(t.app.getHttpServer())
        .patch('/me')
        .set(authed(token))
        .send({})
        .expect(400);
    });
  });

  describe('US5 - abuse protection', () => {
    it('rejects resend inside the cooldown with retryAfter', async () => {
      await register('01000000041').expect(201);
      const res = await sendOtp('01000000041').expect(429);
      expect(res.body).toMatchObject({
        statusCode: 429,
        code: 'OTP_RATE_LIMITED',
      });
      expect(res.body.retryAfter).toEqual(expect.any(Number));
      expect(res.body.details).toMatchObject({ scope: 'resend-cooldown' });
    });

    it('enforces the send budget: 3 sends per phone per 10 minutes', async () => {
      await register('01000000042').expect(201);
      const backdate = { lastSentAt: new Date(Date.now() - 61_000) };
      for (let i = 0; i < 2; i++) {
        await t.system.phoneVerificationChallenge.update({
          where: { phoneNumber: '01000000042' },
          data: backdate,
        });
        await sendOtp('01000000042').expect(201);
      }
      await t.system.phoneVerificationChallenge.update({
        where: { phoneNumber: '01000000042' },
        data: backdate,
      });
      const res = await sendOtp('01000000042').expect(429);
      expect(res.body).toMatchObject({
        statusCode: 429,
        code: 'OTP_RATE_LIMITED',
        details: { scope: 'send' },
      });
    });

    it('caps verify evaluation: at most 10 guesses, then 429', async () => {
      await register('01000000043').expect(201);
      for (let i = 0; i < 10; i++) {
        await verifyOtp('01000000043', '000000').expect(404);
      }
      const res = await verifyOtp('01000000043', '000000').expect(429);
      expect(res.body).toMatchObject({
        statusCode: 429,
        code: 'OTP_RATE_LIMITED',
        details: { scope: 'verify' },
      });
      expect(res.body.retryAfter).toEqual(expect.any(Number));
    });

    it('locks login after 5 failures per phone per 15 minutes', async () => {
      await register('01000000044').expect(201);
      await verifyOtp('01000000044', '123456').expect(200);
      for (let i = 0; i < 5; i++) {
        await request(t.app.getHttpServer())
          .post('/auth/login')
          .send({
            loginType: 'PASSENGER',
            phone: '01000000044',
            password: 'Wrongpass!123',
          })
          .expect(401);
      }
      const res = await request(t.app.getHttpServer())
        .post('/auth/login')
        .send({
          loginType: 'PASSENGER',
          phone: '01000000044',
          password: 'Wrongpass!123',
        })
        .expect(429);
      expect(res.body).toMatchObject({
        statusCode: 429,
        code: 'OTP_RATE_LIMITED',
        details: { scope: 'login' },
      });
    });

    it('keeps OTP probes indistinguishable and secret-free', async () => {
      await register('01000000045').expect(201);
      const wrongCode = await verifyOtp('01000000045', '000000').expect(404);
      const noChallenge = await verifyOtp('01000000046', '000000').expect(404);
      expect(wrongCode.body).toEqual(noChallenge.body);
      const bodies = JSON.stringify([wrongCode.body, noChallenge.body]);
      expect(bodies).not.toContain('123456');
    });

    it('spends comparable effort on unknown phones (dummy-hash mitigation)', async () => {
      const timed = async (phone: string, password: string) => {
        const start = Date.now();
        await request(t.app.getHttpServer())
          .post('/auth/login')
          .send({ loginType: 'PASSENGER', phone, password })
          .expect(401);
        return Date.now() - start;
      };
      await register('01000000047').expect(201);
      await verifyOtp('01000000047', '123456').expect(200);
      const unknown = await timed('01000000048', 'Passw0rd!123');
      const wrong = await timed('01000000047', 'Wrongpass!123');
      // Dummy-hash path must do real work: unknown phones cost ≥20ms…
      expect(unknown).toBeGreaterThanOrEqual(20);
      // …and stay within 5x of a wrong-password attempt (no stark oracle).
      expect(unknown).toBeLessThan(Math.max(500, wrong * 5));
    });
  });
});
