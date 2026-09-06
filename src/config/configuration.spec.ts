import { describe, expect, it } from 'vitest';
import { loadConfig, resolveObserveCredentials } from './configuration.js';

const validEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://app_tenant:pw@localhost:5432/bus',
  DIRECT_URL: 'postgresql://postgres:pw@localhost:5432/bus',
  JWT_SECRET: 'a'.repeat(32),
  JWT_ISSUER: 'bus-api',
  JWT_AUDIENCE: 'bus-client',
  JWT_EXPIRES_IN: '15m',
};

describe('loadConfig', () => {
  it('builds a structured config from environment variables', () => {
    const config = loadConfig({ ...validEnv });
    expect(config.port).toBe(3000);
    expect(config.database.tenantUrl).toBe(validEnv.DATABASE_URL);
    expect(config.database.systemUrl).toBe(validEnv.DIRECT_URL);
    expect(config.jwt).toEqual({
      secret: validEnv.JWT_SECRET,
      issuer: 'bus-api',
      audience: 'bus-client',
      expiresIn: '15m',
    });
  });

  it('honors PORT when provided', () => {
    const config = loadConfig({ ...validEnv, PORT: '8080' });
    expect(config.port).toBe(8080);
  });

  it('throws listing every missing required variable', () => {
    const env = { NODE_ENV: 'development' } as unknown as NodeJS.ProcessEnv;
    expect(() => loadConfig(env)).toThrow(/DATABASE_URL.*DIRECT_URL.*JWT_SECRET.*JWT_ISSUER.*JWT_AUDIENCE.*JWT_EXPIRES_IN/s);
  });

  it('rejects a JWT secret shorter than 32 characters', () => {
    expect(() => loadConfig({ ...validEnv, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('rejects an invalid JWT expiration format', () => {
    expect(() => loadConfig({ ...validEnv, JWT_EXPIRES_IN: 'forever' })).toThrow(/JWT_EXPIRES_IN/);
  });

  it('prefers TEST database URLs when NODE_ENV is test', () => {
    const config = loadConfig({
      ...validEnv,
      NODE_ENV: 'test',
      TEST_DATABASE_URL: 'postgresql://app_tenant:pw@localhost:5432/bus_test',
      TEST_DIRECT_URL: 'postgresql://postgres:pw@localhost:5432/bus_test',
    });
    expect(config.database.tenantUrl).toContain('bus_test');
    expect(config.database.systemUrl).toContain('bus_test');
  });

  it('falls back to DATABASE_URL/DIRECT_URL in test when TEST URLs are absent', () => {
    const config = loadConfig({ ...validEnv, NODE_ENV: 'test' });
    expect(config.database.tenantUrl).toBe(validEnv.DATABASE_URL);
  });
});

describe('resolveObserveCredentials', () => {
  it('returns null when no Observe variables are configured', () => {
    expect(resolveObserveCredentials({})).toBeNull();
  });

  it('returns null for the scaffold placeholder credentials', () => {
    expect(
      resolveObserveCredentials({ OBSERVE_APP_KEY: 'YOUR_APP_KEY', OBSERVE_APP_SECRET: 'YOUR_APP_SECRET' }),
    ).toBeNull();
  });

  it('requires both key and secret to activate telemetry', () => {
    expect(resolveObserveCredentials({ OBSERVE_APP_KEY: 'k', OBSERVE_APP_SECRET: 'YOUR_APP_SECRET' })).toBeNull();
    expect(resolveObserveCredentials({ OBSERVE_APP_KEY: 'YOUR_APP_KEY', OBSERVE_APP_SECRET: 's' })).toBeNull();
    expect(resolveObserveCredentials({ OBSERVE_APP_SECRET: 's' })).toBeNull();
    expect(resolveObserveCredentials({ OBSERVE_APP_KEY: 'k' })).toBeNull();
  });

  it('returns credentials when genuinely configured', () => {
    expect(
      resolveObserveCredentials({ OBSERVE_APP_KEY: 'k_live', OBSERVE_APP_SECRET: 's_live', OBSERVE_SERVICE_ID: 'bus-prod' }),
    ).toEqual({ appKey: 'k_live', appSecret: 's_live', serviceId: 'bus-prod' });
  });

  it('defaults the service id to bus', () => {
    expect(resolveObserveCredentials({ OBSERVE_APP_KEY: 'k_live', OBSERVE_APP_SECRET: 's_live' })).toEqual({
      appKey: 'k_live',
      appSecret: 's_live',
      serviceId: 'bus',
    });
  });
});
