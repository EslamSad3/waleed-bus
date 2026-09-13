import { describe, expect, it, vi } from 'vitest';
import { DriverRosterService } from './driver-roster.service.js';

describe('DriverRosterService onboarding', () => {
  it('creates a verified driver and ACTIVE fleet membership atomically', async () => {
    const createdUser = {
      id: 'driver-1',
      name: 'Karim Ali',
      nickname: 'Karim',
      phoneNumber: '+201001234567',
      picture: null,
      nationalId: null,
      isActive: true,
    };
    const membership = {
      id: 'membership-1',
      userId: 'driver-1',
      fleetId: 'fleet-1',
      roleId: 'driver-role',
      status: 'ACTIVE',
      joinedAt: new Date(),
      assignedBy: 'owner-1',
    };
    const tx = {
      role: {
        findUnique: vi.fn(async () => ({
          id: 'driver-role',
          slug: 'driver',
          isActive: true,
          isSystem: false,
          rolePermissions: [{ permission: { key: 'driver.context.read', isActive: true } }],
        })),
      },
      user: {
        create: vi.fn(async () => createdUser),
        update: vi.fn(async () => ({})),
      },
      fleetMember: { create: vi.fn(async () => membership) },
      session: { updateMany: vi.fn(async () => ({ count: 0 })) },
    };
    const system = {
      $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
      user: { findMany: vi.fn(async () => [createdUser]) },
      role: { findMany: vi.fn(async () => [{ id: 'driver-role', slug: 'driver' }]) },
      busAssignment: { findMany: vi.fn(async () => []) },
    };
    const fleetPath = { run: vi.fn() };
    const tenantContext = {};
    const audit = { log: vi.fn(async () => undefined) };
    const service = new DriverRosterService(fleetPath as never, tenantContext as never, system as never, audit as never);

    const result = await service.add(
      { id: 'owner-1' } as never,
      { fleetId: 'fleet-1', membershipId: 'member-owner', roleId: 'owner-role', roleSlug: 'fleet_owner' },
      { name: 'Karim Ali', nickname: 'Karim', phone: '01001234567', password: 'Passw0rd!123' },
    );

    expect(tx.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ nickname: 'Karim', phoneVerifiedAt: expect.any(Date) }) });
    expect(tx.fleetMember.create).toHaveBeenCalledWith({ data: expect.objectContaining({ fleetId: 'fleet-1', roleId: 'driver-role', status: 'ACTIVE' }) });
    expect(result).toMatchObject({ id: 'membership-1', userId: 'driver-1', nickname: 'Karim', assignments: [] });
  });
});
