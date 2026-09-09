import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration.js';
import type { TestApp } from './helpers/app.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';
import { createUser, seedIsolationWorld, type IsolationWorld } from './helpers/world.js';

const password = 'Passw0rd!123';

describe('Auth (e2e)', () => {
  let t: TestApp;
  let world: IsolationWorld;
  let jwtService: JwtService;

  const login = (email: string, pwd: string) =>
    request(t.app.getHttpServer()).post('/auth/login').send({ email, password: pwd });

  beforeAll(async () => {
    t = await createTestApp();
    jwtService = t.app.get(JwtService);
    await resetDatabase(loadConfig(process.env).database.systemUrl);
    world = await seedIsolationWorld(t.system);
  });

  afterAll(async () => {
    await t?.close();
  });

  it('serves the public health route without a token', async () => {
    const res = await request(t.app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ statusCode: 200, data: { status: 'ok' } });
  });

  it('returns token-only auth response with app_role inside the verified JWT', async () => {
    const res = await login('usera@example.com', password).expect(201);
    expect(res.body.statusCode).toBe(201);
    expect(Object.keys(res.body.data)).toEqual(expect.arrayContaining(['accessToken', 'refreshToken']));
    // no authorization claims duplicated in the body
    const bodyString = JSON.stringify(res.body.data);
    expect(bodyString).not.toContain('role');
    const payload = JSON.parse(Buffer.from(res.body.data.accessToken.split('.')[1], 'base64url').toString());
    expect(payload.app_role).toEqual(expect.any(String));
    expect(payload.authVersion).toBe(1);
    expect(payload.sessionId).toEqual(expect.any(String));
  });

  it('rejects wrong credentials with 401', async () => {
    await login('usera@example.com', 'wrong-password').expect(401);
  });

  it('rejects unknown email with 401 (uniform error)', async () => {
    await login('ghost@example.com', password).expect(401);
  });

  it('rejects malformed login payload with 400', async () => {
    await request(t.app.getHttpServer()).post('/auth/login').send({ email: 'not-an-email', password: 'x' }).expect(400);
  });

  it('rejects an inactive user with 401', async () => {
    await createUser(t.system, { email: 'inactive@example.com', password });
    const user = await t.system.user.findUnique({ where: { email: 'inactive@example.com' } });
    await t.system.user.update({ where: { id: user!.id }, data: { isActive: false } });
    await login('inactive@example.com', password).expect(401);
  });

  it('guards protected routes and exposes /auth/me', async () => {
    await request(t.app.getHttpServer()).get('/auth/me').expect(401);
    const loginRes = await login('usera@example.com', password);
    const me = await request(t.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.data.accessToken}`)
      .expect(200);
    expect(me.body.data).toMatchObject({ email: 'usera@example.com', appRole: 'user' });
  });

  it('rejects a forged app_role claim (signature failure)', async () => {
    const forged = await jwtService.signAsync(
      {
        sub: world.userAId,
        email: 'usera@example.com',
        app_role: 'super_admin',
        authVersion: 1,
        sessionId: '00000000-0000-4000-8000-0000000000ff',
      },
      {
        secret: 'attacker-secret-0123456789abcdef0123',
        issuer: loadConfig(process.env).jwt.issuer,
        audience: loadConfig(process.env).jwt.audience,
        expiresIn: '15m',
      },
    );
    await request(t.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
  });

  it('rejects an expired token with 401', async () => {
    const cfg = loadConfig(process.env).jwt;
    const expired = await jwtService.signAsync(
      { sub: world.userAId, email: 'usera@example.com', app_role: 'user', authVersion: 1, sessionId: 's' },
      { secret: cfg.secret, issuer: cfg.issuer, audience: cfg.audience, expiresIn: '-10s' as JwtSignOptions['expiresIn'] },
    );
    await request(t.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
  });

  it('rejects a token with wrong issuer', async () => {
    const cfg = loadConfig(process.env).jwt;
    const bad = await jwtService.signAsync(
      { sub: world.userAId, email: 'usera@example.com', app_role: 'user', authVersion: 1, sessionId: 's' },
      { secret: cfg.secret, issuer: 'evil', audience: cfg.audience, expiresIn: '15m' as JwtSignOptions['expiresIn'] },
    );
    await request(t.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${bad}`)
      .expect(401);
  });

  it('rotates refresh tokens and rejects reuse of the old one', async () => {
    const loginRes = await login('usera@example.com', password);
    const { accessToken, refreshToken } = loginRes.body.data;
    const refreshRes = await request(t.app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(201);
    expect(refreshRes.body.data.refreshToken).not.toBe(refreshToken);
    // old refresh token no longer usable
    await request(t.app.getHttpServer()).post('/auth/refresh').send({ refreshToken }).expect(401);
    // old access token rejected too (its session was revoked)
    await request(t.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    // new token works
    await request(t.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${refreshRes.body.data.accessToken}`)
      .expect(200);
  });

  it('invalidates outstanding tokens when authVersion is bumped (role change)', async () => {
    const loginRes = await login('usera@example.com', password);
    const { accessToken } = loginRes.body.data;
    await t.system.user.update({
      where: { id: world.userAId },
      data: { authVersion: { increment: 1 } },
    });
    await request(t.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });

  it('logout revokes the current session', async () => {
    const loginRes = await login('usera@example.com', password);
    const { accessToken } = loginRes.body.data;
    await request(t.app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    await request(t.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });
});
