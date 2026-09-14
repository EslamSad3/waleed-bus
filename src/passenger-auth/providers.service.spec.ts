import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '../config/config.module.js';
import { ProvidersService, type FetchFn } from './providers.service.js';

const GOOGLE_AUD = 'unit-test-google-client';

function configStub() {
  return {
    config: {
      passengerAuth: {
        fixedOtpCode: '123456',
        googleClientId: GOOGLE_AUD,
        appleClientId: 'unit-test-apple-client',
        googleJwksUri: 'https://google.test/certs',
        appleJwksUri: 'https://apple.test/keys',
      },
    },
  } as unknown as ConfigService;
}

function rsaPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  return { jwk: { ...jwk, kid: 'rsa-kid-1', use: 'sig' }, pem: pem as string };
}

function ecPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const pem = privateKey.export({ format: 'pem', type: 'sec1' });
  return { jwk: { ...jwk, kid: 'ec-kid-1', use: 'sig' }, pem: pem as string };
}

function fetchStub(jwks: Record<string, unknown>): FetchFn {
  return vi.fn(async () => ({ ok: true, json: async () => jwks }) as never);
}

describe('ProvidersService', () => {
  let jwt: JwtService;
  const now = Math.floor(Date.now() / 1000);

  beforeEach(() => {
    jwt = new JwtService({});
  });

  it('verifies a Google RS256 idToken against the JWKS', async () => {
    const { jwk, pem } = rsaPair();
    const service = new ProvidersService(
      jwt,
      configStub(),
      fetchStub({ keys: [jwk] }),
    );
    const idToken = await jwt.signAsync(
      {
        iss: 'https://accounts.google.com',
        aud: GOOGLE_AUD,
        sub: 'google-123',
        email: 'g@example.com',
        email_verified: true,
        exp: now + 300,
      },
      { secret: pem, algorithm: 'RS256', keyid: 'rsa-kid-1' },
    );
    const identity = await service.verify('GOOGLE', idToken);
    expect(identity).toEqual({
      provider: 'GOOGLE',
      providerUserId: 'google-123',
      email: 'g@example.com',
      emailVerified: true,
      name: null,
    });
  });

  it('verifies an Apple ES256 idToken', async () => {
    const { jwk, pem } = ecPair();
    const service = new ProvidersService(
      jwt,
      configStub(),
      fetchStub({ keys: [jwk] }),
    );
    const idToken = await jwt.signAsync(
      {
        iss: 'https://appleid.apple.com',
        aud: 'unit-test-apple-client',
        sub: 'apple-456',
        email: 'a@privaterelay.appleid.com',
        exp: now + 300,
      },
      { secret: pem, algorithm: 'ES256', keyid: 'ec-kid-1' },
    );
    const identity = await service.verify('APPLE', idToken);
    expect(identity.providerUserId).toBe('apple-456');
  });

  it('rejects tampered tokens without distinguishing the reason', async () => {
    const { jwk, pem } = rsaPair();
    const service = new ProvidersService(
      jwt,
      configStub(),
      fetchStub({ keys: [jwk] }),
    );
    const idToken = await jwt.signAsync(
      {
        iss: 'https://accounts.google.com',
        aud: GOOGLE_AUD,
        sub: 'google-123',
        exp: now + 300,
      },
      { secret: pem, algorithm: 'RS256', keyid: 'rsa-kid-1' },
    );
    const tampered = `${idToken.split('.')[0]}.${idToken.split('.')[1]}-tampered.${idToken.split('.')[2]}`;
    await expect(service.verify('GOOGLE', tampered)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rejects wrong-audience tokens', async () => {
    const { jwk, pem } = rsaPair();
    const service = new ProvidersService(
      jwt,
      configStub(),
      fetchStub({ keys: [jwk] }),
    );
    const idToken = await jwt.signAsync(
      {
        iss: 'https://accounts.google.com',
        aud: 'other-client',
        sub: 'google-123',
        exp: now + 300,
      },
      { secret: pem, algorithm: 'RS256', keyid: 'rsa-kid-1' },
    );
    await expect(service.verify('GOOGLE', idToken)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('treats an unverified provider email as absent', async () => {
    const { jwk, pem } = rsaPair();
    const service = new ProvidersService(
      jwt,
      configStub(),
      fetchStub({ keys: [jwk] }),
    );
    const idToken = await jwt.signAsync(
      {
        iss: 'https://accounts.google.com',
        aud: GOOGLE_AUD,
        sub: 'google-789',
        email: 'u@example.com',
        email_verified: false,
        exp: now + 300,
      },
      { secret: pem, algorithm: 'RS256', keyid: 'rsa-kid-1' },
    );
    const identity = await service.verify('GOOGLE', idToken);
    expect(identity.email).toBeNull();
  });
});
