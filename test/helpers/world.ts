import argon2 from 'argon2';
import type { SystemPrismaService } from '../../src/prisma/prisma.module.js';

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain);
}

/** Ensures permission rows exist for keys like `buses.read` (resource.action). */
export async function ensurePermissions(
  system: SystemPrismaService,
  keys: string[],
): Promise<void> {
  for (const key of keys) {
    const [resource, action] = key.split('.');
    await system.permission.upsert({
      where: { key },
      update: {},
      create: {
        key,
        resource,
        action,
        isSystem: true,
        description: `System permission ${key}`,
      },
    });
  }
}

export async function createRole(
  system: SystemPrismaService,
  input: {
    name: string;
    slug: string;
    isSystem?: boolean;
    permissions?: string[];
  },
) {
  await ensurePermissions(system, input.permissions ?? []);
  const role = await system.role.upsert({
    where: { slug: input.slug },
    update: {},
    create: {
      name: input.name,
      slug: input.slug,
      isSystem: input.isSystem ?? false,
    },
  });
  for (const key of input.permissions ?? []) {
    const permission = await system.permission.findUniqueOrThrow({
      where: { key },
    });
    await system.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: role.id, permissionId: permission.id },
      },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    });
  }
  return role;
}

export async function createUser(
  system: SystemPrismaService,
  input: {
    email: string;
    password: string;
    name?: string;
    isActive?: boolean;
    globalRoleSlug?: string;
  },
) {
  const user = await system.user.upsert({
    where: { email: input.email },
    update: {},
    create: {
      email: input.email,
      passwordHash: await hashPassword(input.password),
      name: input.name,
      isActive: input.isActive ?? true,
    },
  });
  if (input.globalRoleSlug) {
    const role = await system.role.findUniqueOrThrow({
      where: { slug: input.globalRoleSlug },
    });
    await system.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
  }
  return user;
}

export async function createFleet(
  system: SystemPrismaService,
  input: { name: string; ownerId: string },
) {
  return system.fleet.create({
    data: { name: input.name, ownerId: input.ownerId },
  });
}

export async function addMember(
  system: SystemPrismaService,
  input: { userId: string; fleetId: string; roleId: string; status?: string },
) {
  return system.fleetMember.upsert({
    where: { userId_fleetId: { userId: input.userId, fleetId: input.fleetId } },
    update: { status: input.status ?? 'ACTIVE', roleId: input.roleId },
    create: {
      userId: input.userId,
      fleetId: input.fleetId,
      roleId: input.roleId,
      status: input.status ?? 'ACTIVE',
    },
  });
}

export async function createBus(
  system: SystemPrismaService,
  input: { fleetId: string; registrationNumber: string; capacity?: number },
) {
  return system.bus.create({
    data: {
      fleetId: input.fleetId,
      registrationNumber: input.registrationNumber,
      capacity: input.capacity ?? 40,
    },
  });
}

export async function createTrip(
  system: SystemPrismaService,
  input: {
    fleetId: string;
    busId: string;
    origin: string;
    destination: string;
    departAt?: Date;
  },
) {
  return system.trip.create({
    data: {
      fleetId: input.fleetId,
      busId: input.busId,
      origin: input.origin,
      destination: input.destination,
      departAt: input.departAt ?? new Date(Date.now() + 3_600_000),
    },
  });
}

export async function createBooking(
  system: SystemPrismaService,
  input: { fleetId: string; tripId: string; passengerName: string },
) {
  return system.booking.create({
    data: {
      fleetId: input.fleetId,
      tripId: input.tripId,
      passengerName: input.passengerName,
    },
  });
}

/** Phone+password user (spec 003 fleet flows): verified phone unless stated. */
export async function createPhoneUser(
  system: SystemPrismaService,
  input: {
    phone: string;
    password: string;
    name?: string;
    verified?: boolean;
    isActive?: boolean;
  },
) {
  return system.user.create({
    data: {
      phoneNumber: input.phone,
      passwordHash: await hashPassword(input.password),
      name: input.name ?? 'Fleet User',
      phoneVerifiedAt: input.verified === false ? null : new Date(),
      isActive: input.isActive ?? true,
    },
  });
}

export async function setTripStatus(
  system: SystemPrismaService,
  tripId: string,
  status: string,
) {
  return system.trip.update({ where: { id: tripId }, data: { status } });
}

/**
 * Canonical spec-003 roles (mirrors the fleet_owner_driver migration seeds).
 * E2E suites truncate roles/permissions on reset, so every suite ensures its
 * own world via this helper instead of relying on migration seeds.
 */
export async function ensureFleetDriverRoles(
  system: SystemPrismaService,
): Promise<void> {
  await createRole(system, {
    name: 'Fleet Owner',
    slug: 'fleet_owner',
    permissions: [
      'fleet.buses.read',
      'fleet.buses.create',
      'fleet.buses.update',
      'fleet.trips.read',
      'fleet.drivers.read',
      'fleet.drivers.create',
      'fleet.drivers.update',
      'fleet.drivers.delete',
      'fleet.reports.read',
    ],
  });
  await createRole(system, {
    name: 'Driver',
    slug: 'driver',
    permissions: [
      'driver.context.read',
      'driver.passengers.read',
      'driver.trips.operate',
    ],
  });
  await createRole(system, {
    name: 'Independent Driver',
    slug: 'independent_driver',
    permissions: [
      'fleet.buses.read',
      'fleet.buses.create',
      'fleet.buses.update',
      'fleet.trips.read',
      'fleet.reports.read',
      'driver.context.read',
      'driver.passengers.read',
      'driver.trips.operate',
    ],
  });
}

export interface IsolationWorld {
  fleetAId: string;
  fleetBId: string;
  userAId: string;
  userBId: string;
  roleFullId: string;
  roleFullSlug: string;
  roleReadOnlyId: string;
  roleReadOnlySlug: string;
  busAId: string;
  busBId: string;
  tripAId: string;
  tripBId: string;
  bookingBId: string;
  password: string;
}

/**
 * Two fully isolated fleets: userA manages fleet A (full permissions), userB
 * manages fleet B. userA also has a read-only role available in fleet A.
 */
export async function seedIsolationWorld(
  system: SystemPrismaService,
  systemRoleSlug = 'super_admin',
): Promise<IsolationWorld> {
  const password = 'Passw0rd!123';
  const roleFull = await createRole(system, {
    name: 'Fleet Operator',
    slug: `fleet-operator-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    permissions: [
      'buses.read',
      'buses.create',
      'buses.update',
      'buses.delete',
      'trips.read',
      'trips.create',
      'trips.update',
      'trips.delete',
      'bookings.read',
      'bookings.create',
      'bookings.update',
      'bookings.delete',
      'members.read',
      'members.manage',
    ],
  });
  const roleReadOnly = await createRole(system, {
    name: 'Fleet Viewer',
    slug: `fleet-viewer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    permissions: ['buses.read', 'trips.read', 'bookings.read'],
  });
  await createRole(system, {
    name: 'Super Admin',
    slug: systemRoleSlug,
    isSystem: true,
    permissions: [],
  });

  const userA = await createUser(system, {
    email: 'usera@example.com',
    password,
  });
  const userB = await createUser(system, {
    email: 'userb@example.com',
    password,
  });

  const fleetA = await createFleet(system, {
    name: 'Fleet A',
    ownerId: userA.id,
  });
  const fleetB = await createFleet(system, {
    name: 'Fleet B',
    ownerId: userB.id,
  });

  await addMember(system, {
    userId: userA.id,
    fleetId: fleetA.id,
    roleId: roleFull.id,
  });
  await addMember(system, {
    userId: userB.id,
    fleetId: fleetB.id,
    roleId: roleFull.id,
  });

  const busA = await createBus(system, {
    fleetId: fleetA.id,
    registrationNumber: 'BUS-A-001',
  });
  const busB = await createBus(system, {
    fleetId: fleetB.id,
    registrationNumber: 'BUS-B-001',
  });

  const tripA = await createTrip(system, {
    fleetId: fleetA.id,
    busId: busA.id,
    origin: 'Cairo',
    destination: 'Alexandria',
  });
  const tripB = await createTrip(system, {
    fleetId: fleetB.id,
    busId: busB.id,
    origin: 'Giza',
    destination: 'Mansoura',
  });

  const bookingB = await createBooking(system, {
    fleetId: fleetB.id,
    tripId: tripB.id,
    passengerName: 'Passenger B',
  });

  return {
    fleetAId: fleetA.id,
    fleetBId: fleetB.id,
    userAId: userA.id,
    userBId: userB.id,
    roleFullId: roleFull.id,
    roleFullSlug: roleFull.slug,
    roleReadOnlyId: roleReadOnly.id,
    roleReadOnlySlug: roleReadOnly.slug,
    busAId: busA.id,
    busBId: busB.id,
    tripAId: tripA.id,
    tripBId: tripB.id,
    bookingBId: bookingB.id,
    password,
  };
}
