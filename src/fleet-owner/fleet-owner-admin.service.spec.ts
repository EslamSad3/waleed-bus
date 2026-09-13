import { describe, expect, it, vi } from 'vitest';
import { CodedException } from '../common/filters/coded.exception.js';
import { FleetOwnerAdminService } from './fleet-owner-admin.service.js';

function makeService(conflict: { phoneNumber: string | null; nationalId: string | null } | null = null) {
  const user = {
    id: 'owner-1',
    name: 'Ahmed Hassan',
    nickname: 'Ahmed',
    phoneNumber: '01001234567',
    picture: null,
    nationalId: null,
    isActive: true,
    createdAt: new Date('2026-09-13T00:00:00Z'),
  };
  const fleet = { id: 'fleet-1', name: 'Ahmed Transport', isActive: true };
  const tx = {
    user: {
      findFirst: vi.fn(async () => conflict),
      create: vi.fn(async () => user),
    },
    role: {
      findUnique: vi.fn(async () => ({ id: 'owner-role', slug: 'fleet_owner', isActive: true, isSystem: false })),
    },
    fleet: { create: vi.fn(async () => fleet) },
  };
  const system = { $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)) };
  const audit = { log: vi.fn(async () => undefined) };
  return { service: new FleetOwnerAdminService(system as never, audit as never), tx, audit };
}

describe('FleetOwnerAdminService', () => {
  it('creates the owner, first fleet, and ACTIVE membership in one transaction', async () => {
    const { service, tx, audit } = makeService();
    const result = await service.create({
      name: ' Ahmed Hassan ',
      nickname: ' Ahmed ',
      phone: '01001234567',
      password: 'Passw0rd!123',
      fleetName: ' Ahmed Transport ',
    }, 'admin-1');

    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Ahmed Hassan',
        nickname: 'Ahmed',
        phoneNumber: '01001234567',
        phoneVerifiedAt: expect.any(Date),
        passwordHash: expect.any(String),
      }),
    });
    expect(tx.fleet.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Ahmed Transport',
        ownerId: 'owner-1',
        members: { create: expect.objectContaining({ roleId: 'owner-role', status: 'ACTIVE' }) },
      }),
    });
    expect(result).toMatchObject({ id: 'owner-1', fleets: [{ id: 'fleet-1' }] });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'fleet_owner.create' }));
  });

  it('returns a stable conflict with field details before writing duplicate accounts', async () => {
    const { service, tx } = makeService({ phoneNumber: '01001234567', nationalId: null });
    const error = await service.create({
      name: 'Ahmed Hassan',
      nickname: 'Ahmed',
      phone: '01001234567',
      password: 'Passw0rd!123',
      fleetName: 'Ahmed Transport',
    }, 'admin-1').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CodedException);
    expect((error as CodedException).getStatus()).toBe(409);
    expect(JSON.stringify((error as CodedException).getResponse())).toContain('ACCOUNT_ALREADY_EXISTS');
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.fleet.create).not.toHaveBeenCalled();
  });

  it('updates a fleet owner and revokes sessions after a phone or access change', async () => {
    const existing = {
      id: 'owner-1',
      name: 'Ahmed Hassan',
      nickname: 'Ahmed',
      phoneNumber: '01001234567',
      picture: null,
      nationalId: null,
      isActive: true,
      createdAt: new Date('2026-09-13T00:00:00Z'),
    };
    const updated = { ...existing, phoneNumber: '01009998877', isActive: false, authVersion: 2 };
    const fleets = [{ id: 'fleet-1', name: 'Ahmed Transport', isActive: true }];
    const tx = {
      user: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(existing)
          .mockResolvedValueOnce(null),
        update: vi.fn(async () => updated),
      },
      session: { updateMany: vi.fn(async () => ({ count: 1 })) },
      fleet: { findMany: vi.fn(async () => fleets) },
    };
    const system = { $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)) };
    const audit = { log: vi.fn(async () => undefined) };
    const service = new FleetOwnerAdminService(system as never, audit as never);

    const result = await service.update('owner-1', { phone: '01009998877', isActive: false }, 'admin-1');

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'owner-1' },
      data: expect.objectContaining({
        phoneNumber: '01009998877',
        isActive: false,
        authVersion: { increment: 1 },
      }),
    });
    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'owner-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(result).toMatchObject({ id: 'owner-1', phoneNumber: '01009998877', isActive: false });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'fleet_owner.update' }));
  });

  it('does not revoke sessions when profile fields are saved without a security change', async () => {
    const existing = {
      id: 'owner-1',
      name: 'Ahmed Hassan',
      nickname: 'Ahmed',
      phoneNumber: '01001234567',
      picture: null,
      nationalId: null,
      isActive: true,
      createdAt: new Date('2026-09-13T00:00:00Z'),
    };
    const tx = {
      user: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(existing)
          .mockResolvedValueOnce(null),
        update: vi.fn(async () => ({ ...existing, nickname: 'Hamada' })),
      },
      session: { updateMany: vi.fn(async () => ({ count: 0 })) },
      fleet: { findMany: vi.fn(async () => []) },
    };
    const system = { $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)) };
    const audit = { log: vi.fn(async () => undefined) };
    const service = new FleetOwnerAdminService(system as never, audit as never);

    await service.update('owner-1', { nickname: 'Hamada', phone: '01001234567', isActive: true }, 'admin-1');

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'owner-1' },
      data: expect.not.objectContaining({ authVersion: expect.anything() }),
    });
    expect(tx.session.updateMany).not.toHaveBeenCalled();
  });
});
