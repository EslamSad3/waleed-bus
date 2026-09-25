import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/configuration.js';
import type { TestApp } from './helpers/app.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';
import { createPhoneUser, createRole } from './helpers/world.js';

describe('Service config (e2e, spec 013)', () => {
  let t: TestApp;
  let adminToken: string;

  const api = () => request(t.app.getHttpServer());
  const admin = () => ({ Authorization: `Bearer ${adminToken}` });

  beforeAll(async () => {
    t = await createTestApp();
    await resetDatabase(loadConfig(process.env).database.systemUrl);

    await createRole(t.system, {
      name: 'Super Admin',
      slug: 'super_admin',
      isSystem: true,
    });
    await createPhoneUser(t.system, {
      phone: '01009990500',
      password: 'Password123!',
      name: 'Config Admin',
    });
    const adminUser = await t.system.user.findUniqueOrThrow({
      where: { phoneNumber: '01009990500' },
    });
    const roleId = (
      await t.system.role.findUniqueOrThrow({ where: { slug: 'super_admin' } })
    ).id;
    await t.system.userRole.upsert({
      where: { userId_roleId: { userId: adminUser.id, roleId } },
      update: {},
      create: { userId: adminUser.id, roleId },
    });
    adminToken = (
      await api()
        .post('/auth/login')
        .send({ loginType: 'PASSENGER', phone: '01009990500', password: 'Password123!' })
    ).body.data.accessToken;
  });

  afterAll(async () => {
    await t?.close();
  });

  it('replaces the list and serves active entries publicly in order', async () => {
    const put = await api()
      .put('/platform/config/customer-service')
      .set(admin())
      .send({
        entries: [
          { text: 'Contact customer service', type: 'PHONE', value: '0111234567' },
          { text: 'Chat with us on WhatsApp', type: 'WHATSAPP', value: '+201112345678', isActive: false },
          { text: 'Visit our website', type: 'WEBSITE', value: 'https://example.com' },
        ],
      })
      .expect(200);
    expect(put.body.data.map((e: { sortOrder: number }) => e.sortOrder)).toEqual([0, 1, 2]);

    // Public read needs no auth and hides inactive entries.
    const pub = await api().get('/config/customer-service').expect(200);
    expect(pub.body.data.map((e: { text: string }) => e.text)).toEqual([
      'Contact customer service',
      'Visit our website',
    ]);

    // Platform read sees everything.
    const all = await api().get('/platform/config/customer-service').set(admin()).expect(200);
    expect(all.body.data).toHaveLength(3);
  });

  it('reorders via array position and deletes omitted ids', async () => {
    const all = (await api().get('/platform/config/customer-service').set(admin()).expect(200)).body.data as Array<{
      id: string;
      text: string;
      type: string;
      value: string;
      isActive: boolean;
    }>;
    const website = all.find((e) => e.type === 'WEBSITE')!;
    const phone = all.find((e) => e.type === 'PHONE')!;
    const pick = (e: { id: string; text: string; type: string; value: string; isActive: boolean }) => ({
      id: e.id,
      text: e.text,
      type: e.type,
      value: e.value,
      isActive: e.isActive,
    });
    await api()
      .put('/platform/config/customer-service')
      .set(admin())
      .send({ entries: [pick(website), pick(phone)] })
      .expect(200);
    const pub = (await api().get('/config/customer-service').expect(200)).body.data as Array<{ text: string }>;
    expect(pub.map((e) => e.text)).toEqual(['Visit our website', 'Contact customer service']);
  });

  it('rejects bad types, bad values, spoofed ids, and oversized lists', async () => {
    const badType = await api()
      .put('/platform/config/customer-service')
      .set(admin())
      .send({ entries: [{ text: 'x', type: 'SMS', value: '123' }] });
    expect(badType.status).toBe(422);
    expect(badType.body.code).toBe('INVALID_CONFIG_TYPE');

    const badPhone = await api()
      .put('/platform/config/customer-service')
      .set(admin())
      .send({ entries: [{ text: 'x', type: 'PHONE', value: 'abc' }] });
    expect(badPhone.status).toBe(422);
    expect(badPhone.body.code).toBe('INVALID_CONFIG_VALUE');

    const spoofed = await api()
      .put('/platform/config/customer-service')
      .set(admin())
      .send({ entries: [{ id: '00000000-0000-4000-8000-000000000000', text: 'x', type: 'PHONE', value: '0111234567' }] });
    expect(spoofed.status).toBe(422);
    expect(spoofed.body.code).toBe('CONFIG_ENTRY_NOT_FOUND');
  });
});
