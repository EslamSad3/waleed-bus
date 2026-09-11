import { describe, expect, it, vi } from 'vitest';
import { CodedException } from '../common/filters/coded.exception.js';
import { PassengerFeedbackService } from './passenger-feedback.service.js';

const ACTOR = { id: 'driver-1' } as never;
const FLEET = { fleetId: 'fleet-1', membershipId: 'm-1', roleId: 'r-1', roleSlug: 'driver' } as never;

interface FakeDb {
  tripStatus?: string;
  booking?: Record<string, unknown> | null;
  updated?: Record<string, unknown>;
  created?: Record<string, unknown>;
  updateCount?: number;
}

function makeService(db: FakeDb) {
  const tx = {
    booking: {
      findUnique: vi.fn(async () => db.booking ?? null),
      update: vi.fn(async () => db.updated ?? {}),
      updateMany: vi.fn(async () => ({ count: db.updateCount ?? 1 })),
    },
    passengerReport: { create: vi.fn(async () => db.created ?? { id: 'rep-1' }) },
  };
  const anchored = {
    trip: { id: 'trip-1', fleetId: 'fleet-1', busId: 'bus-1', status: db.tripStatus ?? 'COMPLETED' },
    booking: db.booking ?? null,
  };
  const driverOps = {
    assertAssignment: vi.fn(async () => anchored),
  };
  const fleetPath = {
    run: vi.fn(async (_a: unknown, _f: unknown, tenantPath: (tx: unknown) => Promise<unknown>) => tenantPath(tx)),
  };
  const audit = { log: vi.fn(async () => undefined) };
  const service = new PassengerFeedbackService(fleetPath as never, driverOps as never, audit as never);
  return { service, tx, driverOps, audit };
}

describe('PassengerFeedbackService', () => {
  it('driver rating requires a COMPLETED trip (409 RATING_NOT_ALLOWED otherwise)', async () => {
    const { service } = makeService({
      tripStatus: 'DEPARTED',
      booking: { id: 'b-1', tripId: 'trip-1', status: 'CONFIRMED', passengerRating: null },
    });
    const error = await service.ratePassenger(ACTOR, FLEET, 'trip-1', 'b-1', 5).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedException);
    expect(JSON.stringify((error as CodedException).getResponse())).toContain('RATING_NOT_ALLOWED');
  });

  it('driver rating is single-write-per-side: repeat same → 200, change → 409', async () => {
    const same = makeService({
      booking: { id: 'b-1', tripId: 'trip-1', status: 'CONFIRMED', passengerRating: 5, passengerRatedAt: new Date() },
    });
    const ok = await same.service.ratePassenger(ACTOR, FLEET, 'trip-1', 'b-1', 5);
    expect(same.tx.booking.updateMany).not.toHaveBeenCalled();
    expect(ok).toMatchObject({ passengerRating: 5 });

    const changed = makeService({
      booking: { id: 'b-1', tripId: 'trip-1', status: 'CONFIRMED', passengerRating: 5, passengerRatedAt: new Date() },
    });
    const error = await changed.service.ratePassenger(ACTOR, FLEET, 'trip-1', 'b-1', 3).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedException);
    expect((error as CodedException).getStatus()).toBe(409);
  });

  it('report requires the booking on an assigned non-cancelled trip', async () => {
    const cancelled = makeService({
      tripStatus: 'CANCELLED',
      booking: { id: 'b-1', tripId: 'trip-1', status: 'CONFIRMED' },
    });
    const error = await cancelled.service
      .reportPassenger(ACTOR, FLEET, 'trip-1', 'b-1', 'Left luggage behind')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedException);
    expect(JSON.stringify((error as CodedException).getResponse())).toContain('REPORT_NOT_ALLOWED');
  });

  it('report appends a passenger_reports row and audits', async () => {
    const { service, tx, audit } = makeService({
      booking: { id: 'b-1', tripId: 'trip-1', status: 'CONFIRMED' },
      created: { id: 'rep-1', note: 'Left luggage behind' },
    });
    const result = await service.reportPassenger(ACTOR, FLEET, 'trip-1', 'b-1', 'Left luggage behind');
    expect(tx.passengerReport.create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ id: 'rep-1' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'driver.passenger.report' }));
  });
});
