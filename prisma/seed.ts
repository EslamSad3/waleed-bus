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
  ...['users', 'fleets', 'roles', 'permissions', 'buses', 'trips', 'bookings', 'routes', 'stations'].flatMap((resource) =>
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

const EGYPT_GOVERNORATES = [
  ['ALEXANDRIA', 'الإسكندرية', 'Alexandria'], ['ASWAN', 'أسوان', 'Aswan'],
  ['ASYUT', 'أسيوط', 'Asyut'], ['BEHEIRA', 'البحيرة', 'Beheira'],
  ['BENI_SUEF', 'بني سويف', 'Beni Suef'], ['CAIRO', 'القاهرة', 'Cairo'],
  ['DAKAHLIA', 'الدقهلية', 'Dakahlia'], ['DAMIETTA', 'دمياط', 'Damietta'],
  ['FAYOUM', 'الفيوم', 'Fayoum'], ['GHARBIA', 'الغربية', 'Gharbia'],
  ['GIZA', 'الجيزة', 'Giza'], ['ISMAILIA', 'الإسماعيلية', 'Ismailia'],
  ['KAFR_EL_SHEIKH', 'كفر الشيخ', 'Kafr El Sheikh'], ['LUXOR', 'الأقصر', 'Luxor'],
  ['MATROUH', 'مطروح', 'Matrouh'], ['MINYA', 'المنيا', 'Minya'],
  ['MONUFIA', 'المنوفية', 'Monufia'], ['NEW_VALLEY', 'الوادي الجديد', 'New Valley'],
  ['NORTH_SINAI', 'شمال سيناء', 'North Sinai'], ['PORT_SAID', 'بورسعيد', 'Port Said'],
  ['QALYUBIA', 'القليوبية', 'Qalyubia'], ['QENA', 'قنا', 'Qena'],
  ['RED_SEA', 'البحر الأحمر', 'Red Sea'], ['SHARQIA', 'الشرقية', 'Sharqia'],
  ['SOHAG', 'سوهاج', 'Sohag'], ['SOUTH_SINAI', 'جنوب سيناء', 'South Sinai'],
  ['SUEZ', 'السويس', 'Suez'],
] as const;

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

  await prisma.role.upsert({
    where: { slug: 'passenger' },
    update: {},
    create: {
      name: 'Passenger',
      slug: 'passenger',
      description: 'Mobile app passenger (system role; assigned via user_roles)',
      isSystem: true,
    },
  });
  console.log('✔ passenger system role ensured');

  const exampleRoles = [
    {
      slug: 'fleet-owner',
      name: 'Fleet Owner',
      permissions: [
        'fleets.read', 'fleets.update', 'users.read', 'users.create', 'users.update',
        'members.read', 'members.manage', 'buses.read', 'buses.create', 'buses.update', 'buses.delete',
        'trips.read', 'trips.create', 'trips.update', 'trips.delete',
        'bookings.read', 'bookings.create', 'bookings.update', 'bookings.delete',
        'routes.read', 'routes.create', 'routes.update', 'routes.delete',
        'stations.read', 'stations.create', 'stations.update', 'stations.delete',
      ],
    },
    {
      slug: 'fleet-manager',
      name: 'Fleet Manager',
      permissions: [
        'members.read', 'members.manage', 'buses.read', 'buses.create', 'buses.update', 'buses.delete',
        'trips.read', 'trips.create', 'trips.update', 'trips.delete',
        'bookings.read', 'bookings.create', 'bookings.update', 'bookings.delete',
        'routes.read', 'routes.create', 'routes.update', 'routes.delete',
        'stations.read', 'stations.create', 'stations.update', 'stations.delete',
      ],
    },
    {
      slug: 'driver',
      name: 'Driver',
      permissions: ['trips.read', 'bookings.read', 'routes.read', 'stations.read'],
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
  // Local fixture only: a familiar public-facing name for the sample fleet.
  // Never overwrite a nickname an operator has chosen in the dashboard.
  await prisma.user.updateMany({
    where: { email: adminEmail.toLowerCase(), nickname: null },
    data: { nickname: 'Waleed Transit' },
  });

  const governorateIds = new Map<string, string>();
  for (const [code, nameAr, nameEn] of EGYPT_GOVERNORATES) {
    const governorate = await prisma.governorate.upsert({
      where: { code },
      update: { nameAr, nameEn },
      create: { code, nameAr, nameEn },
    });
    governorateIds.set(code, governorate.id);
  }
  console.log(`✔ ${EGYPT_GOVERNORATES.length} Egyptian governorates ensured`);

  // Local-only fixtures: fleets/buses consume the shared system stop + line catalog.
  let sampleFleet = await prisma.fleet.findFirst();
  const admin = existingAdmin ?? (await prisma.user.findUnique({ where: { email: adminEmail.toLowerCase() } }));
  if (!sampleFleet && admin) {
    sampleFleet = await prisma.fleet.create({
      data: {
        name: 'Waleed Transit',
        ownerId: admin.id,
        isActive: true,
      },
    });
    console.log(`✔ sample fleet created: ${sampleFleet.name}`);
  }

  if (sampleFleet) {
    const bus = await prisma.bus.upsert({
      where: {
        fleetId_registrationNumber: {
          fleetId: sampleFleet.id,
          registrationNumber: 'BUS-001',
        },
      },
      update: {},
      create: {
        fleetId: sampleFleet.id,
        registrationNumber: 'BUS-001',
        plateNumber: 'ق ب أ 1234',
        capacity: 14,
        isActive: true,
      },
    });
    console.log(`✔ sample bus ensured: ${bus.registrationNumber} (${bus.plateNumber})`);

    const route = await prisma.route.upsert({
      where: { code: 'CAI-ALX-01' },
      update: {},
      create: {
        line: { connectOrCreate: { where: { code: 'CAI-ALX' }, create: { name: 'Cairo ↔ Alexandria', code: 'CAI-ALX' } } }, direction: 'OUTBOUND',
        name: 'Cairo - Alexandria Express',
        code: 'CAI-ALX-01',
        origin: 'Cairo',
        destination: 'Alexandria',
        qrIdentifier: 'qr_route_cai_alx_01',
        isActive: true,
      },
    });

    const ramses = await prisma.station.upsert({
      where: { id: '7f000001-91ea-13b2-8191-ea1c00000201' },
      update: { governorateId: governorateIds.get('CAIRO')! },
      create: {
        id: '7f000001-91ea-13b2-8191-ea1c00000201',
        name: 'Ramses Station',
        address: 'Ramses Square, Cairo',
        latitude: 30.0631,
        longitude: 31.2497,
        governorateId: governorateIds.get('CAIRO')!,
      },
    });

    const banha = await prisma.station.upsert({
      where: { id: '7f000001-91ea-13b2-8191-ea1c00000202' },
      update: { governorateId: governorateIds.get('QALYUBIA')! },
      create: {
        id: '7f000001-91ea-13b2-8191-ea1c00000202',
        name: 'Banha Station',
        address: 'Banha Transit Hub',
        latitude: 30.466,
        longitude: 31.1853,
        governorateId: governorateIds.get('QALYUBIA')!,
      },
    });

    const alex = await prisma.station.upsert({
      where: { id: '7f000001-91ea-13b2-8191-ea1c00000203' },
      update: { governorateId: governorateIds.get('ALEXANDRIA')! },
      create: {
        id: '7f000001-91ea-13b2-8191-ea1c00000203',
        name: 'Mahatet Masr (Alexandria)',
        address: 'Alexandria Station Square',
        latitude: 31.1927,
        longitude: 29.906,
        governorateId: governorateIds.get('ALEXANDRIA')!,
      },
    });

    await prisma.routeStation.upsert({
      where: { routeId_stopOrder: { routeId: route.id, stopOrder: 1 } },
      update: {},
      create: {
        routeId: route.id,
        stationId: ramses.id,
        stopOrder: 1,
        estimatedStopMinutes: 0,
      },
    });

    await prisma.routeStation.upsert({
      where: { routeId_stopOrder: { routeId: route.id, stopOrder: 2 } },
      update: {},
      create: {
        routeId: route.id,
        stationId: banha.id,
        stopOrder: 2,
        estimatedStopMinutes: 45,
      },
    });

    await prisma.routeStation.upsert({
      where: { routeId_stopOrder: { routeId: route.id, stopOrder: 3 } },
      update: {},
      create: {
        routeId: route.id,
        stationId: alex.id,
        stopOrder: 3,
        estimatedStopMinutes: 150,
      },
    });

    await prisma.bus.update({
      where: { id: bus.id },
      data: { lineId: route.lineId },
    });

    console.log('✔ sample route, stations, and stops ensured');

    // Ensure test passenger user exists
    const passengerRole = await prisma.role.findUnique({ where: { slug: 'passenger' } });
    const passengerPasswordHash = await argon2.hash('Password123!');
    const testPassenger = await prisma.user.upsert({
      where: { phoneNumber: '01000000001' },
      update: {
        passwordHash: passengerPasswordHash,
        phoneVerifiedAt: new Date(),
        name: 'Ahmed Hassan (Test Passenger)',
      },
      create: {
        email: 'passenger.ahmed@example.com',
        phoneNumber: '01000000001',
        name: 'Ahmed Hassan (Test Passenger)',
        passwordHash: passengerPasswordHash,
        phoneVerifiedAt: new Date(),
        globalRoles: passengerRole ? { create: { roleId: passengerRole.id } } : undefined,
      },
    });
    console.log(`✔ test passenger ensured: ${testPassenger.phoneNumber} (${testPassenger.name})`);

    // Ensure test driver user exists
    const testDriver = await prisma.user.upsert({
      where: { phoneNumber: '01100000000' },
      update: {
        passwordHash: passengerPasswordHash,
        phoneVerifiedAt: new Date(),
        name: 'Mohamed Ibrahim (Test Driver)',
      },
      create: {
        email: 'driver.mohamed@example.com',
        phoneNumber: '01100000000',
        name: 'Mohamed Ibrahim (Test Driver)',
        passwordHash: passengerPasswordHash,
        phoneVerifiedAt: new Date(),
      },
    });
    console.log(`✔ test driver ensured: ${testDriver.phoneNumber} (${testDriver.name})`);

    // Ensure active bus assignment for driver
    await prisma.busAssignment.upsert({
      where: { id: '7f000001-91ea-13b2-8191-ea1c00000401' },
      update: { status: 'ACTIVE' },
      create: {
        id: '7f000001-91ea-13b2-8191-ea1c00000401',
        fleetId: sampleFleet.id,
        busId: bus.id,
        driverUserId: testDriver.id,
        status: 'ACTIVE',
      },
    });

    // Ensure secondary bus (high capacity, 28 seats)
    const bus2 = await prisma.bus.upsert({
      where: {
        fleetId_registrationNumber: {
          fleetId: sampleFleet.id,
          registrationNumber: 'BUS-002',
        },
      },
      update: {},
      create: {
        fleetId: sampleFleet.id,
        registrationNumber: 'BUS-002',
        plateNumber: 'س ي ن 5678',
        capacity: 28,
        isActive: true,
      },
    });

    // Ensure secondary route: Cairo -> Sharm El Sheikh
    const routeSharm = await prisma.route.upsert({
      where: { code: 'CAI-SSH-01' },
      update: {},
      create: {
        line: { connectOrCreate: { where: { code: 'CAI-SSH' }, create: { name: 'Cairo ↔ Sharm El Sheikh', code: 'CAI-SSH' } } }, direction: 'OUTBOUND',
        name: 'Cairo - Sharm El Sheikh Highway',
        code: 'CAI-SSH-01',
        origin: 'Cairo',
        destination: 'Sharm El Sheikh',
        qrIdentifier: 'qr_route_cai_ssh_01',
        isActive: true,
      },
    });

    // The Sharm line was originally seeded only as a bare outbound Route.
    // Keep demo data aligned with the parent-Line model: every line has two
    // usable, independently editable directions and ordered stop points.
    const sharm = await prisma.station.upsert({
      where: { id: '7f000001-91ea-13b2-8191-ea1c00000204' },
      update: { governorateId: governorateIds.get('SOUTH_SINAI')! },
      create: {
        id: '7f000001-91ea-13b2-8191-ea1c00000204',
        name: 'Sharm El Sheikh Station',
        address: 'Peace Road, Sharm El Sheikh',
        latitude: 27.9158,
        longitude: 34.3299,
        governorateId: governorateIds.get('SOUTH_SINAI')!,
      },
    });
    const routeSharmReturn = await prisma.route.upsert({
      where: { code: 'SSH-CAI-01' },
      update: {},
      create: {
        lineId: routeSharm.lineId,
        direction: 'RETURN',
        name: 'Sharm El Sheikh - Cairo Return',
        code: 'SSH-CAI-01',
        origin: 'Sharm El Sheikh',
        destination: 'Cairo',
        qrIdentifier: 'qr_route_ssh_cai_01',
        isActive: true,
      },
    });
    for (const [routeId, stops] of [
      [routeSharm.id, [ramses.id, sharm.id]],
      [routeSharmReturn.id, [sharm.id, ramses.id]],
    ] as const) {
      for (const [index, stationId] of stops.entries()) {
        await prisma.routeStation.upsert({
          where: { routeId_stopOrder: { routeId, stopOrder: index + 1 } },
          update: { stationId, stopType: 'BOTH' },
          create: { routeId, stationId, stopOrder: index + 1, estimatedStopMinutes: index * 240, stopType: 'BOTH' },
        });
      }
    }

    // Ensure return route: Alexandria -> Cairo
    const routeReturn = await prisma.route.upsert({
      where: { code: 'ALX-CAI-01' },
      update: {},
      create: {
        line: { connectOrCreate: { where: { code: 'CAI-ALX' }, create: { name: 'Cairo ↔ Alexandria', code: 'CAI-ALX' } } }, direction: 'RETURN',
        name: 'Alexandria - Cairo Return Express',
        code: 'ALX-CAI-01',
        origin: 'Alexandria',
        destination: 'Cairo',
        qrIdentifier: 'qr_route_alx_cai_01',
        isActive: true,
      },
    });

    // Return route stations
    await prisma.routeStation.upsert({
      where: { routeId_stopOrder: { routeId: routeReturn.id, stopOrder: 1 } },
      update: {},
      create: {
        routeId: routeReturn.id,
        stationId: alex.id,
        stopOrder: 1,
        estimatedStopMinutes: 0,
      },
    });
    await prisma.routeStation.upsert({
      where: { routeId_stopOrder: { routeId: routeReturn.id, stopOrder: 2 } },
      update: {},
      create: {
        routeId: routeReturn.id,
        stationId: banha.id,
        stopOrder: 2,
        estimatedStopMinutes: 90,
      },
    });
    await prisma.routeStation.upsert({
      where: { routeId_stopOrder: { routeId: routeReturn.id, stopOrder: 3 } },
      update: {},
      create: {
        routeId: routeReturn.id,
        stationId: ramses.id,
        stopOrder: 3,
        estimatedStopMinutes: 150,
      },
    });

    // -------------------------------------------------------------------------
    // 10 DISTINCT TRIPS COVERING 10 TEST CASES
    // -------------------------------------------------------------------------
    const now = new Date();

    // CASE 1: Standard open trip (Cairo -> Alex, tomorrow 08:00 UTC, 14 available seats)
    const d1 = new Date(now);
    d1.setUTCDate(now.getUTCDate() + 1);
    d1.setUTCHours(8, 0, 0, 0);
    const trip1 = await prisma.trip.upsert({
      where: { id: 'a0000001-0000-0000-0000-000000000001' },
      update: { departAt: d1, fare: 50.0, status: 'SCHEDULED' },
      create: {
        id: 'a0000001-0000-0000-0000-000000000001',
        fleetId: sampleFleet.id,
        busId: bus.id,
        routeId: route.id,
        origin: 'Cairo',
        destination: 'Alexandria',
        departAt: d1,
        fare: 50.0,
        status: 'SCHEDULED',
      },
    });

    // CASE 2: Concurrency / Contention test (13/14 seats booked, exactly 1 available seat)
    const d2 = new Date(now);
    d2.setUTCDate(now.getUTCDate() + 1);
    d2.setUTCHours(10, 0, 0, 0);
    const trip2 = await prisma.trip.upsert({
      where: { id: 'a0000001-0000-0000-0000-000000000002' },
      update: { departAt: d2, fare: 55.0, status: 'SCHEDULED' },
      create: {
        id: 'a0000001-0000-0000-0000-000000000002',
        fleetId: sampleFleet.id,
        busId: bus.id,
        routeId: route.id,
        origin: 'Cairo',
        destination: 'Alexandria',
        departAt: d2,
        fare: 55.0,
        status: 'SCHEDULED',
      },
    });
    // Seed 13 seats booked
    await prisma.booking.upsert({
      where: { id: 'b0000002-0000-0000-0000-000000000001' },
      update: { seats: 13, status: 'CONFIRMED' },
      create: {
        id: 'b0000002-0000-0000-0000-000000000001',
        fleetId: sampleFleet.id,
        tripId: trip2.id,
        passengerName: 'Existing Group Booking',
        seats: 13,
        status: 'CONFIRMED',
        paymentMethod: 'CASH',
        paymentStatus: 'PENDING',
        totalAmount: 13 * 55.0,
      },
    });

    // CASE 3: Fully Booked / Sold Out trip (14/14 seats booked, 0 available seats)
    const d3 = new Date(now);
    d3.setUTCDate(now.getUTCDate() + 1);
    d3.setUTCHours(12, 0, 0, 0);
    const trip3 = await prisma.trip.upsert({
      where: { id: 'a0000001-0000-0000-0000-000000000003' },
      update: { departAt: d3, fare: 50.0, status: 'SCHEDULED' },
      create: {
        id: 'a0000001-0000-0000-0000-000000000003',
        fleetId: sampleFleet.id,
        busId: bus.id,
        routeId: route.id,
        origin: 'Cairo',
        destination: 'Alexandria',
        departAt: d3,
        fare: 50.0,
        status: 'SCHEDULED',
      },
    });
    await prisma.booking.upsert({
      where: { id: 'b0000003-0000-0000-0000-000000000001' },
      update: { seats: 14, status: 'CONFIRMED' },
      create: {
        id: 'b0000003-0000-0000-0000-000000000001',
        fleetId: sampleFleet.id,
        tripId: trip3.id,
        passengerName: 'Sold Out Charter',
        seats: 14,
        status: 'CONFIRMED',
        paymentMethod: 'CASH',
        paymentStatus: 'PENDING',
        totalAmount: 14 * 50.0,
      },
    });

    // CASE 4: Duplicate-time overlap test (departs tomorrow at 08:30 UTC, 30m after Trip 1)
    const d4 = new Date(now);
    d4.setUTCDate(now.getUTCDate() + 1);
    d4.setUTCHours(8, 30, 0, 0);
    await prisma.trip.upsert({
      where: { id: 'a0000001-0000-0000-0000-000000000004' },
      update: { departAt: d4, fare: 50.0, status: 'SCHEDULED' },
      create: {
        id: 'a0000001-0000-0000-0000-000000000004',
        fleetId: sampleFleet.id,
        busId: bus.id,
        routeId: route.id,
        origin: 'Cairo',
        destination: 'Alexandria',
        departAt: d4,
        fare: 50.0,
        status: 'SCHEDULED',
      },
    });

    // CASE 5: High Capacity Microbus (28 seats) - Cairo -> Sharm El Sheikh
    const d5 = new Date(now);
    d5.setUTCDate(now.getUTCDate() + 2);
    d5.setUTCHours(6, 0, 0, 0);
    await prisma.trip.upsert({
      where: { id: 'a0000001-0000-0000-0000-000000000005' },
      update: { departAt: d5, fare: 220.0, status: 'SCHEDULED' },
      create: {
        id: 'a0000001-0000-0000-0000-000000000005',
        fleetId: sampleFleet.id,
        busId: bus2.id,
        routeId: routeSharm.id,
        origin: 'Cairo',
        destination: 'Sharm El Sheikh',
        departAt: d5,
        fare: 220.0,
        status: 'SCHEDULED',
      },
    });

    // CASE 6: Partial Cancellation test trip (departs in 3 days, pre-booked 3 seats by test passenger)
    const d6 = new Date(now);
    d6.setUTCDate(now.getUTCDate() + 3);
    d6.setUTCHours(9, 0, 0, 0);
    const trip6 = await prisma.trip.upsert({
      where: { id: 'a0000001-0000-0000-0000-000000000006' },
      update: { departAt: d6, fare: 60.0, status: 'SCHEDULED' },
      create: {
        id: 'a0000001-0000-0000-0000-000000000006',
        fleetId: sampleFleet.id,
        busId: bus.id,
        routeId: route.id,
        origin: 'Cairo',
        destination: 'Alexandria',
        departAt: d6,
        fare: 60.0,
        status: 'SCHEDULED',
      },
    });
    await prisma.booking.upsert({
      where: { id: 'b0000001-0000-0000-0000-000000000006' },
      update: { seats: 3, status: 'CONFIRMED' },
      create: {
        id: 'b0000001-0000-0000-0000-000000000006',
        fleetId: sampleFleet.id,
        tripId: trip6.id,
        passengerUserId: testPassenger.id,
        passengerName: testPassenger.name ?? 'Ahmed Hassan',
        passengerPhone: testPassenger.phoneNumber,
        seats: 3,
        status: 'CONFIRMED',
        paymentMethod: 'VODAFONE_CASH',
        paymentStatus: 'PAID',
        totalAmount: 3 * 60.0,
      },
    });

    // CASE 7: Day-of-Travel / Active Trip test (departs TODAY in 1 hour with live tracking & driver)
    const d7 = new Date(now);
    d7.setUTCHours(now.getUTCHours() + 1, 0, 0, 0);
    const trip7 = await prisma.trip.upsert({
      where: { id: 'a0000001-0000-0000-0000-000000000007' },
      update: { departAt: d7, fare: 50.0, status: 'SCHEDULED' },
      create: {
        id: 'a0000001-0000-0000-0000-000000000007',
        fleetId: sampleFleet.id,
        busId: bus.id,
        routeId: route.id,
        origin: 'Cairo',
        destination: 'Alexandria',
        departAt: d7,
        fare: 50.0,
        status: 'SCHEDULED',
      },
    });
    await prisma.booking.upsert({
      where: { id: 'b0000001-0000-0000-0000-000000000007' },
      update: { seats: 2, status: 'CONFIRMED' },
      create: {
        id: 'b0000001-0000-0000-0000-000000000007',
        fleetId: sampleFleet.id,
        tripId: trip7.id,
        passengerUserId: testPassenger.id,
        passengerName: testPassenger.name ?? 'Ahmed Hassan',
        passengerPhone: testPassenger.phoneNumber,
        seats: 2,
        status: 'CONFIRMED',
        paymentMethod: 'CASH',
        paymentStatus: 'PENDING',
        totalAmount: 2 * 50.0,
      },
    });

    // CASE 8: Already Departed Trip (departs 2 hours ago -> cancellation rejection test)
    const d8 = new Date(now);
    d8.setUTCHours(now.getUTCHours() - 2, 0, 0, 0);
    const trip8 = await prisma.trip.upsert({
      where: { id: 'a0000001-0000-0000-0000-000000000008' },
      update: { departAt: d8, fare: 50.0, status: 'DEPARTED' },
      create: {
        id: 'a0000001-0000-0000-0000-000000000008',
        fleetId: sampleFleet.id,
        busId: bus.id,
        routeId: route.id,
        origin: 'Cairo',
        destination: 'Alexandria',
        departAt: d8,
        fare: 50.0,
        status: 'DEPARTED',
      },
    });
    await prisma.booking.upsert({
      where: { id: 'b0000001-0000-0000-0000-000000000008' },
      update: { status: 'CONFIRMED' },
      create: {
        id: 'b0000001-0000-0000-0000-000000000008',
        fleetId: sampleFleet.id,
        tripId: trip8.id,
        passengerUserId: testPassenger.id,
        passengerName: testPassenger.name ?? 'Ahmed Hassan',
        passengerPhone: testPassenger.phoneNumber,
        seats: 1,
        status: 'CONFIRMED',
        paymentMethod: 'CASH',
        paymentStatus: 'PAID',
        totalAmount: 50.0,
      },
    });

    // CASE 9: Completed Trip (completed yesterday -> passenger rating & feedback test)
    const d9 = new Date(now);
    d9.setUTCDate(now.getUTCDate() - 1);
    d9.setUTCHours(10, 0, 0, 0);
    const trip9 = await prisma.trip.upsert({
      where: { id: 'a0000001-0000-0000-0000-000000000009' },
      update: { departAt: d9, fare: 50.0, status: 'COMPLETED' },
      create: {
        id: 'a0000001-0000-0000-0000-000000000009',
        fleetId: sampleFleet.id,
        busId: bus.id,
        routeId: route.id,
        origin: 'Cairo',
        destination: 'Alexandria',
        departAt: d9,
        fare: 50.0,
        status: 'COMPLETED',
      },
    });
    await prisma.booking.upsert({
      where: { id: 'b0000001-0000-0000-0000-000000000009' },
      update: { status: 'CONFIRMED', boardedAt: d9 },
      create: {
        id: 'b0000001-0000-0000-0000-000000000009',
        fleetId: sampleFleet.id,
        tripId: trip9.id,
        passengerUserId: testPassenger.id,
        passengerName: testPassenger.name ?? 'Ahmed Hassan',
        passengerPhone: testPassenger.phoneNumber,
        seats: 1,
        status: 'CONFIRMED',
        paymentMethod: 'CASH',
        paymentStatus: 'PAID',
        boardedAt: d9,
        totalAmount: 50.0,
      },
    });

    // CASE 10: Alexandria -> Cairo Return Route (upcoming departure in 5 days for public QR scan)
    const d10 = new Date(now);
    d10.setUTCDate(now.getUTCDate() + 5);
    d10.setUTCHours(15, 0, 0, 0);
    await prisma.trip.upsert({
      where: { id: 'a0000001-0000-0000-0000-000000000010' },
      update: { departAt: d10, fare: 50.0, status: 'SCHEDULED' },
      create: {
        id: 'a0000001-0000-0000-0000-000000000010',
        fleetId: sampleFleet.id,
        busId: bus.id,
        routeId: routeReturn.id,
        origin: 'Alexandria',
        destination: 'Cairo',
        departAt: d10,
        fare: 50.0,
        status: 'SCHEDULED',
      },
    });

    // Passenger-facing local schedule: one open trip for every day in the
    // seven-day booking window, covering both directions and both sample lines.
    const localSchedule = [
      { route: route, bus: bus, origin: 'Cairo', destination: 'Alexandria', hour: 16, fare: 65 },
      { route: routeReturn, bus: bus, origin: 'Alexandria', destination: 'Cairo', hour: 17, fare: 65 },
      { route: routeSharm, bus: bus2, origin: 'Cairo', destination: 'Sharm El Sheikh', hour: 7, fare: 240 },
      { route: routeSharmReturn, bus: bus2, origin: 'Sharm El Sheikh', destination: 'Cairo', hour: 8, fare: 240 },
      { route: route, bus: bus, origin: 'Cairo', destination: 'Alexandria', hour: 14, fare: 70 },
      { route: routeReturn, bus: bus, origin: 'Alexandria', destination: 'Cairo', hour: 15, fare: 70 },
      { route: routeSharm, bus: bus2, origin: 'Cairo', destination: 'Sharm El Sheikh', hour: 6, fare: 245 },
    ];
    for (const [index, item] of localSchedule.entries()) {
      const departure = new Date(now);
      departure.setUTCDate(now.getUTCDate() + index + 1);
      departure.setUTCHours(item.hour, 0, 0, 0);
      const id = `a0000001-0000-0000-0000-${String(101 + index).padStart(12, '0')}`;
      await prisma.trip.upsert({
        where: { id },
        update: { routeId: item.route.id, busId: item.bus.id, origin: item.origin, destination: item.destination, departAt: departure, fare: item.fare, status: 'SCHEDULED' },
        create: { id, fleetId: sampleFleet.id, routeId: item.route.id, busId: item.bus.id, origin: item.origin, destination: item.destination, departAt: departure, fare: item.fare, status: 'SCHEDULED' },
      });
    }

    console.log('✔ 10 distinct testing trips and test user fixtures created successfully:');
    console.log('  1. Case 1: Standard open trip (14 available)');
    console.log('  2. Case 2: Contention test (1 available seat, 13 booked)');
    console.log('  3. Case 3: Sold out trip (0 available seats, 14 booked)');
    console.log('  4. Case 4: Overlapping duplicate departure window (8:30 vs 8:00)');
    console.log('  5. Case 5: 28-seat microbus group booking (Cairo -> Sharm)');
    console.log('  6. Case 6: Pre-booked 3 seats for partial cancellation test');
    console.log('  7. Case 7: Day-of-travel active trip in 1h with assigned driver');
    console.log('  8. Case 8: Already departed trip for cancellation rejection');
    console.log('  9. Case 9: Completed trip with boarded booking for ratings');
    console.log('  10. Case 10: Return route Alexandria -> Cairo for QR resolution');
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('✖ seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
