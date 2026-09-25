import { describe, expect, it, vi } from 'vitest';
import { CodedException } from '../common/filters/coded.exception.js';
import { BookingsService } from './bookings.service.js';
import { FleetBookingService } from './fleet-booking.service.js';
import { PassengerBookingService } from './passenger-booking.service.js';
import { PassengerRatingService } from './passenger-rating.service.js';

function makeBookingsService(
  fleetPath: any = { run: vi.fn() },
  tenantContext: any = { withUserContext: vi.fn() },
  system: any = {},
  audit: any = { log: vi.fn(async () => undefined) },
): BookingsService {
  return new BookingsService(
    new FleetBookingService(fleetPath),
    new PassengerBookingService(system, audit, { resolveInTx: async () => ({ status: null, promotionId: null, promoCode: null, discountAmount: 0 }), recordUsage: async () => undefined } as never),
    new PassengerRatingService(tenantContext, system),
  );
}

describe('BookingsService - Passenger Booking (US2 & US3)', () => {
  const actor = { id: 'passenger-uuid-1', appRole: 'passenger' } as never;

  function makeService(opts: {
    callerPhone?: string | null;
    phoneVerifiedAt?: Date | null;
    tripRows?: Array<Record<string, unknown>>;
    bookedSeats?: number;
    duplicateBooking?: { id: string; tripId: string } | null;
  }) {
    const caller = {
      id: 'passenger-uuid-1',
      name: 'Ahmed Hassan',
      phoneNumber:
        opts.callerPhone !== undefined ? opts.callerPhone : '01000000001',
      phoneVerifiedAt:
        opts.phoneVerifiedAt !== undefined ? opts.phoneVerifiedAt : new Date(),
    };

    const tripRows = opts.tripRows ?? [
      {
        id: 'trip-1',
        fleet_id: 'fleet-1',
        bus_id: 'bus-1',
        status: 'SCHEDULED',
        depart_at: new Date(Date.now() + 86400000),
        fare: 50.0,
        capacity: 14,
        origin: 'Cairo',
        destination: 'Alexandria',
        route_id: 'route-1',
      },
    ];

    const routeStops = [
      { stationId: 'station-boarding-1', stopOrder: 1, stopType: 'BOTH' },
      { stationId: 'station-landing-1', stopOrder: 2, stopType: 'BOTH' },
    ];

    const mockBookingCreate = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'booking-new-1',
        tripId: data.tripId,
        passengerUserId: data.passengerUserId,
        passengerName: data.passengerName,
        passengerPhone: data.passengerPhone,
        seats: data.seats,
        status: data.status,
        paymentMethod: data.paymentMethod,
        paymentStatus: data.paymentStatus,
        totalAmount: data.totalAmount,
        confirmedAt: new Date(),
        trip: {
          origin: 'Cairo',
          destination: 'Alexandria',
          departAt: new Date(Date.now() + 86400000),
        },
      }),
    );

    const tx = {
      $queryRaw: vi.fn(async () => tripRows),
      routeStation: {
        findMany: vi.fn(async () => routeStops),
      },
      booking: {
        findFirst: vi.fn(async () => opts.duplicateBooking ?? null),
        aggregate: vi.fn(async () => ({
          _sum: { seats: opts.bookedSeats ?? 0 },
        })),
        create: mockBookingCreate,
      },
    };

    const mockSystem = {
      user: {
        findUnique: vi.fn(async () => caller),
      },
      $transaction: vi.fn(async (cb: (client: typeof tx) => Promise<unknown>) =>
        cb(tx),
      ),
    };

    const fleetPath = { run: vi.fn() };
    const tenantContext = { withUserContext: vi.fn() };
    const audit = { log: vi.fn(async () => undefined) };

    const service = makeBookingsService(
      fleetPath,
      tenantContext,
      mockSystem,
      audit,
    );

    return { service, mockSystem, tx, audit, mockBookingCreate };
  }

  it('rejects booking when passenger phone is not verified (403 PHONE_NOT_VERIFIED)', async () => {
    const { service } = makeService({ phoneVerifiedAt: null });
    const err = await service
      .createPassengerBooking(actor, {
        tripId: 'trip-1',
        seatCount: 1,
        paymentMethod: 'CASH',
        boardingStationId: 'station-boarding-1',
        landingStationId: 'station-landing-1',
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getStatus()).toBe(403);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'PHONE_NOT_VERIFIED',
    });
  });

  it('atomically reserves seats when requestedSeats <= remaining capacity', async () => {
    const { service, audit } = makeService({ bookedSeats: 10 }); // 14 capacity, 10 booked = 4 available
    const result = await service.createPassengerBooking(actor, {
      tripId: 'trip-1',
      seatCount: 2,
      paymentMethod: 'CASH',
      boardingStationId: 'station-boarding-1',
      landingStationId: 'station-landing-1',
    });

    expect(result).toMatchObject({
      id: 'booking-new-1',
      tripId: 'trip-1',
      seats: 2,
      status: 'CONFIRMED',
      totalAmount: '100.00',
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'booking.create',
        resource: 'booking',
      }),
    );
  });

  it('rejects booking with 409 SEATS_UNAVAILABLE when seatCount exceeds capacity', async () => {
    const { service } = makeService({ bookedSeats: 13 }); // 14 capacity, 13 booked = 1 available
    const err = await service
      .createPassengerBooking(actor, {
        tripId: 'trip-1',
        seatCount: 2, // requesting 2
        paymentMethod: 'CASH',
        boardingStationId: 'station-boarding-1',
        landingStationId: 'station-landing-1',
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getStatus()).toBe(409);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'SEATS_UNAVAILABLE',
    });
  });

  it('rejects booking with 409 DUPLICATE_TIME_BOOKING if active booking exists in ±2h window', async () => {
    const { service } = makeService({
      duplicateBooking: { id: 'existing-b-1', tripId: 'existing-trip-1' },
    });
    const err = await service
      .createPassengerBooking(actor, {
        tripId: 'trip-1',
        seatCount: 1,
        paymentMethod: 'CASH',
        boardingStationId: 'station-boarding-1',
        landingStationId: 'station-landing-1',
        confirmTimeConflict: false,
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getStatus()).toBe(409);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'DUPLICATE_TIME_BOOKING',
      details: {
        existingBookingId: 'existing-b-1',
        existingTripId: 'existing-trip-1',
      },
    });
  });

  it('allows booking when confirmTimeConflict is true even if conflict exists', async () => {
    const { service } = makeService({
      duplicateBooking: { id: 'existing-b-1', tripId: 'existing-trip-1' },
    });
    const result = await service.createPassengerBooking(actor, {
      tripId: 'trip-1',
      seatCount: 1,
      paymentMethod: 'CASH',
      boardingStationId: 'station-boarding-1',
      landingStationId: 'station-landing-1',
      confirmTimeConflict: true,
    });

    expect(result.status).toBe('CONFIRMED');
  });

  describe('US4: View and Filter Passenger Bookings', () => {
    it('finds passenger bookings scoped strictly to caller user ID with cursor pagination', async () => {
      const mockBookings = [
        {
          id: 'b-1',
          tripId: 't-1',
          passengerName: 'Ahmed Hassan',
          seats: 2,
          status: 'CONFIRMED',
          totalAmount: 100.0,
          confirmedAt: new Date(),
          trip: {
            id: 't-1',
            origin: 'Cairo',
            destination: 'Alexandria',
            departAt: new Date(Date.now() + 86400000),
            status: 'SCHEDULED',
          },
        },
      ];

      const mockSystem = {
        booking: {
          findMany: vi.fn(async () => mockBookings),
        },
      };

      const fleetPath = { run: vi.fn() };
      const tenantContext = { withUserContext: vi.fn() };
      const audit = { log: vi.fn() };
      const service = makeBookingsService(
        fleetPath,
        tenantContext,
        mockSystem,
        audit,
      );

      const result = await service.findPassengerBookings(actor, {
        status: 'CONFIRMED',
        timeFilter: 'upcoming',
      });

      expect(mockSystem.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            passengerUserId: 'passenger-uuid-1',
            status: 'CONFIRMED',
          }),
        }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('b-1');
    });

    it('finds single booking by ID when owned by passenger', async () => {
      const mockBooking = {
        id: 'b-1',
        tripId: 't-1',
        passengerUserId: 'passenger-uuid-1',
        passengerName: 'Ahmed Hassan',
        seats: 2,
        status: 'CONFIRMED',
        paymentMethod: 'CASH',
        paymentStatus: 'PENDING',
        totalAmount: 100.0,
        confirmedAt: new Date(),
        trip: {
          id: 't-1',
          origin: 'Cairo',
          destination: 'Alexandria',
          departAt: new Date(Date.now() + 86400000),
          status: 'SCHEDULED',
          bus: { plateNumber: 'ق ب أ 1234', registrationNumber: 'BUS-001' },
        },
      };

      const mockSystem = {
        booking: {
          findUnique: vi.fn(async () => mockBooking),
        },
      };

      const fleetPath = { run: vi.fn() };
      const tenantContext = { withUserContext: vi.fn() };
      const audit = { log: vi.fn() };
      const service = makeBookingsService(
        fleetPath,
        tenantContext,
        mockSystem,
        audit,
      );

      const result = await service.findPassengerBookingById(actor, 'b-1');
      expect(result.id).toBe('b-1');
      expect(result.trip.bus?.plateNumber).toBe('ق ب أ 1234');
    });

    it('returns 404 BOOKING_NOT_FOUND when booking belongs to another passenger (OWASP BOLA)', async () => {
      const mockBooking = {
        id: 'foreign-b-1',
        tripId: 't-1',
        passengerUserId: 'different-user-uuid',
        seats: 1,
        status: 'CONFIRMED',
      };

      const mockSystem = {
        booking: {
          findUnique: vi.fn(async () => mockBooking),
        },
      };

      const fleetPath = { run: vi.fn() };
      const tenantContext = { withUserContext: vi.fn() };
      const audit = { log: vi.fn() };
      const service = makeBookingsService(
        fleetPath,
        tenantContext,
        mockSystem,
        audit,
      );

      const err = await service
        .findPassengerBookingById(actor, 'foreign-b-1')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CodedException);
      expect((err as CodedException).getStatus()).toBe(404);
      expect((err as CodedException).getResponse()).toMatchObject({
        code: 'BOOKING_NOT_FOUND',
      });
    });
  });

  describe('US5: Cancel Passenger Booking', () => {
    it('cancels all seats when seatsToCancel is omitted (full cancellation)', async () => {
      const mockBooking = {
        id: 'b-1',
        tripId: 't-1',
        passengerUserId: 'passenger-uuid-1',
        seats: 2,
        status: 'CONFIRMED',
        boardedAt: null,
        trip: {
          id: 't-1',
          fleetId: 'fleet-1',
          status: 'SCHEDULED',
          departAt: new Date(Date.now() + 86400000),
        },
      };

      const mockSystem = {
        $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) =>
          cb({
            booking: {
              findUnique: vi.fn(async () => mockBooking),
              update: vi.fn(async ({ data }: any) => ({
                ...mockBooking,
                ...data,
                cancelledAt: new Date(),
              })),
            },
          }),
        ),
      };

      const service = makeBookingsService({}, {}, mockSystem, { log: vi.fn() });

      const result = await service.cancelPassengerBooking(actor, 'b-1', {
        reason: 'Change of plans',
      });

      expect(result.status).toBe('CANCELLED');
      expect(result.seats).toBe(0);
      expect(result.cancelledSeats).toBe(2);
      expect(result.paymentStatus).toBe('REFUND_PENDING');
      expect(result.cancellationReason).toBe('Change of plans');
    });

    it('cancels partial seats when seatsToCancel < booked seats', async () => {
      const mockBooking = {
        id: 'b-1',
        tripId: 't-1',
        passengerUserId: 'passenger-uuid-1',
        seats: 3,
        status: 'CONFIRMED',
        boardedAt: null,
        trip: {
          id: 't-1',
          fleetId: 'fleet-1',
          status: 'SCHEDULED',
          departAt: new Date(Date.now() + 86400000),
        },
      };

      const mockSystem = {
        $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) =>
          cb({
            booking: {
              findUnique: vi.fn(async () => mockBooking),
              update: vi.fn(async ({ data }: any) => ({
                ...mockBooking,
                ...data,
                cancelledAt: new Date(),
              })),
            },
          }),
        ),
      };

      const service = makeBookingsService({}, {}, mockSystem, { log: vi.fn() });

      const result = await service.cancelPassengerBooking(actor, 'b-1', {
        seatsToCancel: 1,
        reason: 'Friend not coming',
      });

      expect(result.status).toBe('CONFIRMED');
      expect(result.seats).toBe(2);
      expect(result.cancelledSeats).toBe(1);
      expect(result.paymentStatus).toBe('REFUND_PENDING');
    });

    it('rejects when seatsToCancel exceeds booked seats', async () => {
      const mockBooking = {
        id: 'b-1',
        tripId: 't-1',
        passengerUserId: 'passenger-uuid-1',
        seats: 2,
        status: 'CONFIRMED',
        boardedAt: null,
        trip: {
          id: 't-1',
          fleetId: 'fleet-1',
          status: 'SCHEDULED',
          departAt: new Date(Date.now() + 86400000),
        },
      };

      const mockSystem = {
        $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) =>
          cb({
            booking: {
              findUnique: vi.fn(async () => mockBooking),
            },
          }),
        ),
      };

      const service = makeBookingsService({}, {}, mockSystem, { log: vi.fn() });

      const err = await service
        .cancelPassengerBooking(actor, 'b-1', { seatsToCancel: 3 })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(CodedException);
      expect((err as CodedException).getStatus()).toBe(400);
      expect((err as CodedException).getResponse()).toMatchObject({
        code: 'INVALID_SEAT_COUNT',
      });
    });

    it('rejects when booking is already cancelled', async () => {
      const mockBooking = {
        id: 'b-1',
        tripId: 't-1',
        passengerUserId: 'passenger-uuid-1',
        seats: 0,
        status: 'CANCELLED',
        boardedAt: null,
        trip: {
          id: 't-1',
          fleetId: 'fleet-1',
          status: 'SCHEDULED',
          departAt: new Date(Date.now() + 86400000),
        },
      };

      const mockSystem = {
        $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) =>
          cb({
            booking: {
              findUnique: vi.fn(async () => mockBooking),
            },
          }),
        ),
      };

      const service = makeBookingsService({}, {}, mockSystem, { log: vi.fn() });

      const err = await service
        .cancelPassengerBooking(actor, 'b-1', {})
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(CodedException);
      expect((err as CodedException).getStatus()).toBe(409);
      expect((err as CodedException).getResponse()).toMatchObject({
        code: 'BOOKING_ALREADY_CANCELLED',
      });
    });

    it('rejects when passenger already boarded', async () => {
      const mockBooking = {
        id: 'b-1',
        tripId: 't-1',
        passengerUserId: 'passenger-uuid-1',
        seats: 2,
        status: 'CONFIRMED',
        boardedAt: new Date(),
        trip: {
          id: 't-1',
          fleetId: 'fleet-1',
          status: 'SCHEDULED',
          departAt: new Date(Date.now() + 86400000),
        },
      };

      const mockSystem = {
        $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) =>
          cb({
            booking: {
              findUnique: vi.fn(async () => mockBooking),
            },
          }),
        ),
      };

      const service = makeBookingsService({}, {}, mockSystem, { log: vi.fn() });

      const err = await service
        .cancelPassengerBooking(actor, 'b-1', {})
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(CodedException);
      expect((err as CodedException).getStatus()).toBe(409);
      expect((err as CodedException).getResponse()).toMatchObject({
        code: 'BOOKING_NOT_CANCELLABLE',
      });
    });

    it('rejects when trip already departed', async () => {
      const mockBooking = {
        id: 'b-1',
        tripId: 't-1',
        passengerUserId: 'passenger-uuid-1',
        seats: 2,
        status: 'CONFIRMED',
        boardedAt: null,
        trip: {
          id: 't-1',
          fleetId: 'fleet-1',
          status: 'DEPARTED',
          departAt: new Date(Date.now() - 3600000),
        },
      };

      const mockSystem = {
        $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) =>
          cb({
            booking: {
              findUnique: vi.fn(async () => mockBooking),
            },
          }),
        ),
      };

      const service = makeBookingsService({}, {}, mockSystem, { log: vi.fn() });

      const err = await service
        .cancelPassengerBooking(actor, 'b-1', {})
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(CodedException);
      expect((err as CodedException).getStatus()).toBe(409);
      expect((err as CodedException).getResponse()).toMatchObject({
        code: 'TRIP_ALREADY_STARTED',
      });
    });
  });

  describe('US6: Active Trip Status and Real-time Tracking Access', () => {
    it('returns active trip details with bus, driver, and Firebase RTDB tracking channel', async () => {
      const mockBooking = {
        id: 'booking-active-1',
        seats: 2,
        boardedAt: null,
        droppedAt: null,
        trip: {
          id: 'trip-active-1',
          origin: 'Cairo',
          destination: 'Alexandria',
          departAt: new Date(Date.now() + 3600000), // 1 hour from now
          status: 'SCHEDULED',
          bus: {
            plateNumber: 'ق ب أ 1234',
            capacity: 14,
            assignments: [
              {
                status: 'ACTIVE',
                driver: {
                  name: 'Mohamed Ibrahim',
                  phoneNumber: '01100000000',
                  picture: null,
                },
              },
            ],
          },
        },
      };

      const mockSystem = {
        booking: {
          findFirst: vi.fn(async () => mockBooking),
        },
      };

      const service = makeBookingsService({}, {}, mockSystem, { log: vi.fn() });

      const result = await service.findActivePassengerTrip(actor);

      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        bookingId: 'booking-active-1',
        seats: 2,
        boardingStatus: 'NOT_BOARDED',
        trip: {
          id: 'trip-active-1',
          origin: 'Cairo',
          destination: 'Alexandria',
          bus: {
            plateNumber: 'ق ب أ 1234',
            capacity: 14,
          },
          driver: {
            name: 'Mohamed Ibrahim',
            phone: '01100000000',
          },
        },
        tracking: {
          provider: 'firebase_rtdb',
          channel: 'trips/trip-active-1',
        },
      });
    });

    it('returns null when passenger has no confirmed booking in active window', async () => {
      const mockSystem = {
        booking: {
          findFirst: vi.fn(async () => null),
        },
      };

      const service = makeBookingsService({}, {}, mockSystem, { log: vi.fn() });

      const result = await service.findActivePassengerTrip(actor);
      expect(result).toBeNull();
    });
  });
});
