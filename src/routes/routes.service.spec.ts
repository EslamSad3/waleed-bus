import { describe, expect, it, vi } from 'vitest';
import { CodedException } from '../common/filters/coded.exception.js';
import { RoutesService } from './routes.service.js';

describe('RoutesService (US8)', () => {
  it('resolves route by qrIdentifier with ordered stations and upcoming trips', async () => {
    const mockRoute = {
      id: 'route-uuid-1',
      name: 'Cairo - Alexandria Express',
      code: 'CAI-ALX-01',
      origin: 'Cairo',
      destination: 'Alexandria',
      qrIdentifier: 'qr_cai_alx_01',
      isActive: true,
      stations: [
        {
          stopOrder: 1,
          estimatedStopMinutes: 0,
          station: {
            id: 'st-1',
            name: 'Ramses Station',
            address: 'Cairo',
            latitude: 30.0631,
            longitude: 31.2497,
          },
        },
        {
          stopOrder: 2,
          estimatedStopMinutes: 45,
          station: {
            id: 'st-2',
            name: 'Banha Station',
            address: 'Banha',
            latitude: 30.466,
            longitude: 31.1853,
          },
        },
      ],
    };

    const mockTrips = [
      {
        id: 'trip-1',
        departAt: new Date(Date.now() + 7200000),
        fare: 50.0,
        bus: {
          capacity: 14,
          plateNumber: 'ق ب أ 1234',
        },
        bookings: [{ seats: 2 }, { seats: 3 }],
      },
    ];

    const mockSystem = {
      route: {
        findFirst: vi.fn(async () => mockRoute),
      },
      trip: {
        findMany: vi.fn(async () => mockTrips),
      },
    };

    const service = new RoutesService(mockSystem as never);
    const result = await service.resolvePublicRoute('qr_cai_alx_01');

    expect(result).toMatchObject({
      id: 'route-uuid-1',
      name: 'Cairo - Alexandria Express',
      code: 'CAI-ALX-01',
      origin: 'Cairo',
      destination: 'Alexandria',
      qrIdentifier: 'qr_cai_alx_01',
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
      upcomingTrips: [
        {
          id: 'trip-1',
          fare: '50.00',
          capacity: 14,
          availableSeats: 9, // 14 - 5
          bus: { plateNumber: 'ق ب أ 1234' },
        },
      ],
    });
  });

  it('throws 404 ROUTE_NOT_FOUND when identifier does not match any active route', async () => {
    const mockSystem = {
      route: {
        findFirst: vi.fn(async () => null),
      },
    };

    const service = new RoutesService(mockSystem as never);
    const err = await service
      .resolvePublicRoute('unknown_qr')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getStatus()).toBe(404);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'ROUTE_NOT_FOUND',
    });
  });
});
