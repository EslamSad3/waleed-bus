import { describe, expect, it, vi } from 'vitest';
import { CodedException } from '../common/filters/coded.exception.js';
import { PassengerBookingService } from './passenger-booking.service.js';

const ACTOR = { id: 'passenger-uuid-1', appRole: 'passenger' } as never;

function makeService(opts: {
  maxBookingSeats?: number | null;
  otherUser?: { id: string } | null;
} = {}) {
  const caller = {
    id: 'passenger-uuid-1',
    name: 'Ahmed Hassan',
    phoneNumber: '01000000001',
    phoneVerifiedAt: new Date(),
    maxBookingSeats: opts.maxBookingSeats ?? null,
  };
  const tripRows = [
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
  const created: Record<string, unknown>[] = [];
  const tx = {
    $queryRaw: vi.fn(async () => tripRows),
    routeStation: { findMany: vi.fn(async () => routeStops) },
    booking: {
      findFirst: vi.fn(async () => null),
      aggregate: vi.fn(async () => ({ _sum: { seats: 0 } })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 'b1', ...data, confirmedAt: new Date(), trip: { origin: 'C', destination: 'A', departAt: new Date() } };
      }),
    },
    user: {
      findFirst: vi.fn(async () => opts.otherUser ?? null),
    },
  };
  const mockSystem = {
    user: { findUnique: vi.fn(async () => caller) },
    $transaction: vi.fn(async (cb: (c: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const service = new PassengerBookingService(
    mockSystem as never,
    { log: vi.fn(async () => undefined) } as never,
    { resolveInTx: vi.fn(async () => ({ status: null, promotionId: null, promoCode: null, discountAmount: 0 })), recordUsage: vi.fn(async () => undefined) } as never,
  );
  const base = {
    tripId: 'trip-1',
    paymentMethod: 'CASH',
    boardingStationId: 'station-boarding-1',
    landingStationId: 'station-landing-1',
  };
  return { service, created, base };
}

describe('Booking seat limits + for-other + note (spec 010)', () => {
  it('rejects 6 seats for a default-limit user with BOOKING_SEAT_LIMIT_EXCEEDED', async () => {
    const { service, base } = makeService();
    const err = await service
      .createPassengerBooking(ACTOR, { ...base, seatCount: 6, bookingFor: 'SELF' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'BOOKING_SEAT_LIMIT_EXCEEDED',
    });
  });

  it('allows 5 seats by default and honors an override of 8', async () => {
    const def = makeService();
    await def.service.createPassengerBooking(ACTOR, { ...def.base, seatCount: 5, bookingFor: 'SELF' });
    expect(def.created).toHaveLength(1);
    const over = makeService({ maxBookingSeats: 8 });
    await over.service.createPassengerBooking(ACTOR, { ...over.base, seatCount: 8, bookingFor: 'SELF' });
    expect(over.created).toHaveLength(1);
    const err = await over.service
      .createPassengerBooking(ACTOR, { ...over.base, seatCount: 9, bookingFor: 'SELF' })
      .catch((e: unknown) => e);
    expect((err as CodedException).getResponse()).toMatchObject({
      code: 'BOOKING_SEAT_LIMIT_EXCEEDED',
    });
  });

  it('stores SELF snapshots from the account with bookingFor SELF', async () => {
    const { service, base, created } = makeService();
    await service.createPassengerBooking(ACTOR, { ...base, seatCount: 1, bookingFor: 'SELF', note: 'Wait near the bridge' });
    expect(created[0]).toMatchObject({
      bookingFor: 'SELF',
      passengerUserId: 'passenger-uuid-1',
      passengerName: 'Ahmed Hassan',
      passengerPhone: '01000000001',
      note: 'Wait near the bridge',
    });
  });

  it('resolves OTHER passengerUserId by phone when the account exists', async () => {
    const { service, base, created } = makeService({ otherUser: { id: 'other-uuid-9' } });
    await service.createPassengerBooking(ACTOR, {
      ...base,
      seatCount: 1,
      bookingFor: 'OTHER',
      passengerName: 'Mona',
      passengerPhone: '01000000002',
    });
    expect(created[0]).toMatchObject({
      bookingFor: 'OTHER',
      passengerUserId: 'other-uuid-9',
      passengerName: 'Mona',
      passengerPhone: '01000000002',
    });
  });

  it('keeps passengerUserId null for OTHER without an account', async () => {
    const { service, base, created } = makeService({ otherUser: null });
    await service.createPassengerBooking(ACTOR, {
      ...base,
      seatCount: 1,
      bookingFor: 'OTHER',
      passengerName: 'Walk-in',
      passengerPhone: '01000000003',
    });
    expect(created[0]).toMatchObject({ bookingFor: 'OTHER', passengerUserId: null });
  });

  it('rejects OTHER without name/phone with 400', async () => {
    const { service, base } = makeService();
    const err = await service
      .createPassengerBooking(ACTOR, { ...base, seatCount: 1, bookingFor: 'OTHER' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodedException);
    expect((err as CodedException).getStatus()).toBe(400);
  });
});
