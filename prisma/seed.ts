/**
 * Idempotent seed: system permission catalog, the super_admin system role,
 * example dynamic fleet roles, and the initial super admin (from env).
 * Run: npm run db:seed
 */
import 'dotenv/config';
import argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const CATALOG: { key: string; resource: string; action: string; description: string }[] = [
  ...['users', 'fleets', 'roles', 'permissions', 'buses', 'trips', 'bookings'].flatMap((resource) =>
    ['read', 'create', 'update', 'delete'].map((action) => ({
      key: `${resource}.${action}`,
      resource,
      action,
      description: `${action} ${resource}`,
    })),
  ),
  { key: 'members.read', resource: 'members', action: 'read', description: 'read fleet members' },
  { key: 'members.manage', resource: 'members', action: 'manage', description: 'manage fleet members' },
  { key: 'audit.read', resource: 'audit', action: 'read', description: 'read the audit trail' },
];

async function main(): Promise<void> {
  const systemUrl = process.env.DIRECT_URL;
  const adminEmail = process.env.SEED_SUPER_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_SUPER_ADMIN_PASSWORD;
  if (!systemUrl) throw new Error('DIRECT_URL is required');
  if (!adminEmail || !adminPassword) {
    throw new Error('SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD are required');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: systemUrl }) });

  for (const permission of CATALOG) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: {},
      create: { ...permission, isSystem: true },
    });
  }
  console.log(`✔ ${CATALOG.length} system permissions ensured`);

  const superAdminRole = await prisma.role.upsert({
    where: { slug: 'super_admin' },
    update: {},
    create: {
      name: 'Super Admin',
      slug: 'super_admin',
      description: 'Platform administrator (system role)',
      isSystem: true,
    },
  });
  console.log('✔ super_admin system role ensured');

  const exampleRoles = [
    {
      slug: 'fleet_owner',
      name: 'Fleet Owner',
      permissions: [
        'fleets.read', 'fleets.update', 'users.read', 'users.create', 'users.update',
        'members.read', 'members.manage', 'buses.read', 'buses.create', 'buses.update', 'buses.delete',
        'trips.read', 'trips.create', 'trips.update', 'trips.delete',
        'bookings.read', 'bookings.create', 'bookings.update', 'bookings.delete',
      ],
    },
    {
      slug: 'fleet-manager',
      name: 'Fleet Manager',
      permissions: [
        'members.read', 'members.manage', 'buses.read', 'buses.create', 'buses.update', 'buses.delete',
        'trips.read', 'trips.create', 'trips.update', 'trips.delete',
        'bookings.read', 'bookings.create', 'bookings.update', 'bookings.delete',
      ],
    },
    {
      slug: 'driver',
      name: 'Driver',
      permissions: ['trips.read', 'bookings.read'],
    },
  ];
  for (const role of exampleRoles) {
    await prisma.role.upsert({
      where: { slug: role.slug },
      update: {},
      create: {
        name: role.name,
        slug: role.slug,
        description: `Seeded example role (fully dynamic — edit or delete via the API)`,
        rolePermissions: {
          create: role.permissions.map((key) => ({
            permission: { connect: { key } },
          })),
        },
      },
    });
  }
  console.log(`✔ ${exampleRoles.length} example dynamic roles ensured`);

  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail.toLowerCase() },
  });
  if (!existingAdmin) {
    const admin = await prisma.user.create({
      data: {
        email: adminEmail.toLowerCase(),
        passwordHash: await argon2.hash(adminPassword),
        name: 'Super Admin',
        globalRoles: { create: { roleId: superAdminRole.id } },
      },
    });
    console.log(`✔ initial super admin created: ${admin.email}`);
  } else {
    console.log(`✔ super admin already exists: ${existingAdmin.email}`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('✖ seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
