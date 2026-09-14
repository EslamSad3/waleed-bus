import { describe, expect, it, vi } from 'vitest';
import { TripsService } from './trips.service.js';

describe('TripsService - Public Trip Search & Details (US1)', () => {
  function makeService(mockSystem: Record<string, unknown>) {
    const fleetPath = {
      run: vi.fn(),
    };
    const service = new TripsService(fleetPath as never, mockSystem as never);
    return { service, mockSystem, fleetPath };
  }

  it('searches trips by origin, destination, and strict calendar day with available seats', async () => {
    const mockTrips = [
      {
        id: 'trip-1',
        origin: 'Cairo',
        destination: 'Alexandria',
        departAt: new Date('2026-09-15T08:00:00.000Z'),
        fare: 50.0,
        status: 'SCHEDULED',
        routeId: 'route-1',
        route: {
          id: 'route-1',
          name: 'Cairo - Alexandria Express',
          code: 'CAI-ALX-01',
        },
        bus: { plateNumber: 'ق ب أ 1234', capacity: 14 },
        bookings: [{ seats: 3 }, { seats: 2 }],
      },
    ];

    const mockSystem = {
      trip: {
        findMany: vi.fn(async () => mockTrips),
      },
    };

    const { service } = makeService(mockSystem);
    const result = await service.searchTrips({
      origin: 'Cairo',
      destination: 'Alexandria',
      date: '2026-09-15',
    });

    expect(mockSystem.trip.findMany).toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'trip-1',
      origin: 'Cairo',
      destination: 'Alexandria',
      capacity: 14,
      availableSeats: 9, // 14 - (3 + 2)
      fare: '50.00',
      routeName: 'Cairo - Alexandria Express',
      bus: { plateNumber: 'ق ب أ 1234' },
      paymentMethods: ['CASH', 'VODAFONE_CASH'],
    });
  });

  it('returns empty list when no trips match the search criteria', async () => {
    const mockSystem = {
      trip: {
        findMany: vi.fn(async () => []),
      },
    };

    const { service } = makeService(mockSystem);
    const result = await service.searchTrips({
      origin: 'Aswan',
      destination: 'Luxor',
      date: '2026-09-15',
    });

    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it('finds trip details with ordered stations and live remaining capacity', async () => {
    const mockTrip = {
      id: 'trip-1',
      origin: 'Cairo',
      destination: 'Alexandria',
      departAt: new Date('2026-09-15T08:00:00.000Z'),
      fare: 50.0,
      status: 'SCHEDULED',
      bus: {
        id: 'bus-1',
        plateNumber: 'ق ب أ 1234',
        registrationNumber: 'BUS-001',
        capacity: 14,
      },
      route: {
        id: 'route-1',
        name: 'Cairo - Alexandria Express',
        code: 'CAI-ALX-01',
        stations: [
          {
            stopOrder: 1,
            estimatedStopMinutes: 0,
            station: { id: 'st-1', name: 'Ramses Station' },
          },
          {
            stopOrder: 2,
            estimatedStopMinutes: 45,
            station: { id: 'st-2', name: 'Banha Station' },
          },
        ],
      },
      bookings: [{ seats: 4 }],
    };

    const mockSystem = {
      trip: {
        findUnique: vi.fn(async () => mockTrip),
      },
    };

    const { service } = makeService(mockSystem);
    const details = await service.findTripDetails('trip-1');

    expect(details).toMatchObject({
      id: 'trip-1',
      availableSeats: 10, // 14 - 4
      capacity: 14,
      fare: '50.00',
      bus: {
        plateNumber: 'ق ب أ 1234',
        registrationNumber: 'BUS-001',
      },
      route: {
        name: 'Cairo - Alexandria Express',
        stations: [
          {
            id: 'st-1',
            name: 'Ramses Station',
            stopOrder: 1,
            estimatedStopMinutes: 0,
          },
          {
            id: 'st-2',
            name: 'Banha Station',
            stopOrder: 2,
            estimatedStopMinutes: 45,
          },
        ],
      },
    });
  });

  it('throws 404 when trip details queried for nonexistent trip', async () => {
    const mockSystem = {
      trip: {
        findUnique: vi.fn(async () => null),
      },
    };

    const { service } = makeService(mockSystem);
    await expect(service.findTripDetails('nonexistent')).rejects.toThrow();
  });
});
