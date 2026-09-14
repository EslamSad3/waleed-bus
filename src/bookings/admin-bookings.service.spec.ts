import { describe, expect, it, vi } from 'vitest';
import { CodedException } from '../common/filters/coded.exception.js';
import { AdminBookingsService } from './admin-bookings.service.js';

describe('AdminBookingsService', () => {
  const actorUserId = 'admin-user-uuid-1';

  function setupService(overrides?: {
    bookingFindMany?: unknown[];
    bookingFindUnique?: unknown;
    bookingAggregate?: { _sum: { seats: number | null } };
    auditLogs?: unknown[];
    txQueryRaw?: unknown[];
    reportFindUnique?: unknown;
  }) {
    const mockTx = {
      $queryRaw: vi.fn(
        async () =>
          overrides?.txQueryRaw ?? [
            {
              id: 'trip-1',
              depart_at: new Date(Date.now() + 86400000),
              capacity: 14,
            },
          ],
      ),
      booking: {
        findUnique: vi.fn(async () => overrides?.bookingFindUnique ?? null),
        aggregate: vi.fn(
          async () => overrides?.bookingAggregate ?? { _sum: { seats: 2 } },
        ),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'booking-1',
          ...data,
          updatedAt: new Date(),
        })),
      },
      passengerReport: {
        findUnique: vi.fn(async () => overrides?.reportFindUnique ?? null),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'report-1',
          bookingId: 'booking-1',
          driverId: 'driver-1',
          passengerId: 'passenger-1',
          note: 'Driver note',
          ...data,
          updatedAt: new Date(),
        })),
      },
    };

    const mockSystem = {
      booking: {
        findMany: vi.fn(async () => overrides?.bookingFindMany ?? []),
        findUnique: vi.fn(async () => overrides?.bookingFindUnique ?? null),
        aggregate: vi.fn(
          async () => overrides?.bookingAggregate ?? { _sum: { seats: 2 } },
        ),
      },
      auditLog: {
        findMany: vi.fn(async () => overrides?.auditLogs ?? []),
      },
      $transaction: vi.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) =>
        cb(mockTx),
      ),
    };

    const mockAudit = {
      log: vi.fn(async () => undefined),
    };

    const service = new AdminBookingsService(
      mockSystem as never,
      mockAudit as never,
    );

    return { service, mockSystem, mockTx, mockAudit };
  }

  describe('US1: findAll (listing & multi-criteria filtering)', () => {
    it('returns empty list with null nextCursor when no bookings match', async () => {
      const { service } = setupService({ bookingFindMany: [] });
      const result = await service.findAll({});
      expect(result.items).toEqual([]);
      expect(result.nextCursor).toBeNull();
    });

    it('maps query filters properly to prisma where clause', async () => {
      const { service, mockSystem } = setupService({
        bookingFindMany: [
          {
            id: 'b-1',
            fleetId: 'fleet-1',
            fleet: { name: 'Express' },
            tripId: 'trip-1',
            passengerName: 'Ahmed',
            passengerPhone: '01012345678',
            passengerUserId: 'user-1',
            seats: 2,
            status: 'CONFIRMED',
            totalAmount: '100.00',
            refundedAmount: '0.00',
            paymentMethod: 'VODAFONE_CASH',
            paymentStatus: 'PAID',
            paymentReference: 'VF-123',
            boardedAt: null,
            dropStatus: null,
            reports: [],
            trip: {
              id: 'trip-1',
              departAt: new Date('2026-09-20T10:00:00Z'),
              origin: 'Cairo',
              destination: 'Alex',
            },
            confirmedAt: new Date('2026-09-14T08:00:00Z'),
            createdAt: new Date('2026-09-14T08:00:00Z'),
          },
        ],
      });

      const result = await service.findAll({
        fleetId: 'fleet-1',
        passengerPhone: '01012',
        departureFrom: '2026-09-20T00:00:00Z',
        hasReports: true,
      });

      expect(mockSystem.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            fleetId: 'fleet-1',
            passengerPhone: { contains: '01012', mode: 'insensitive' },
            reports: { some: {} },
            trip: expect.objectContaining({
              departAt: expect.objectContaining({
                gte: new Date('2026-09-20T00:00:00Z'),
              }),
            }),
          }),
        }),
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: 'b-1',
        fleetName: 'Express',
        originName: 'Cairo',
        destinationName: 'Alex',
      });
    });
  });

  describe('US2: findOne (comprehensive details & inline audit trail)', () => {
    it('throws 404 BOOKING_NOT_FOUND when booking does not exist', async () => {
      const { service } = setupService({ bookingFindUnique: null });
      await expect(service.findOne('non-existent-id')).rejects.toThrow(
        CodedException,
      );
      await expect(service.findOne('non-existent-id')).rejects.toMatchObject({
        status: 404,
        response: expect.objectContaining({ code: 'BOOKING_NOT_FOUND' }),
      });
    });

    it('returns full relational hierarchy with computed availableSeats and audit trail', async () => {
      const mockBooking = {
        id: 'booking-1',
        fleetId: 'fleet-1',
        tripId: 'trip-1',
        fleet: { name: 'Express' },
        passenger: { id: 'p-1', name: 'Ahmed' },
        trip: {
          id: 'trip-1',
          departAt: new Date(),
          origin: 'Cairo',
          destination: 'Alex',
          fare: '50.00',
          status: 'SCHEDULED',
          bus: {
            id: 'bus-1',
            registrationNumber: 'XYZ-123',
            capacity: 14,
            assignments: [
              {
                driver: {
                  id: 'd-1',
                  name: 'Mahmoud',
                  phoneNumber: '01111111111',
                },
              },
            ],
          },
          route: { stations: [] },
        },
        reports: [],
        status: 'CONFIRMED',
        seats: 2,
        totalAmount: '100.00',
        refundedAmount: '0.00',
        paymentMethod: 'CASH',
        paymentStatus: 'PAID',
        busRating: 5,
        driverRating: 5,
        passengerRating: null,
      };

      const { service } = setupService({
        bookingFindUnique: mockBooking,
        bookingAggregate: { _sum: { seats: 4 } }, // 14 capacity - 4 booked = 10 available
        auditLogs: [
          {
            id: 'audit-1',
            action: 'booking.verify_payment',
            actorUserId: 'admin-1',
            metadata: {},
            createdAt: new Date(),
          },
        ],
      });

      const res = (await service.findOne('booking-1')) as Record<
        string,
        unknown
      >;
      expect(res.id).toBe('booking-1');
      expect(res.fleetName).toBe('Express');
      const trip = res.trip as Record<string, unknown>;
      expect(trip.availableSeats).toBe(10);
      expect(trip.driver).toEqual({
        id: 'd-1',
        name: 'Mahmoud',
        phoneNumber: '01111111111',
      });
      const auditTrail = res.auditTrail as unknown[];
      expect(auditTrail).toHaveLength(1);
    });
  });

  describe('US3: verifyPayment & failPayment (offline wallet settlement)', () => {
    it('verifies offline payment when amount matches totalAmount', async () => {
      const { service, mockAudit } = setupService({
        bookingFindUnique: {
          id: 'booking-1',
          totalAmount: 100.0,
          paymentStatus: 'PENDING',
          paymentMethod: 'VODAFONE_CASH',
          paymentNotes: null,
        },
      });

      const res = (await service.verifyPayment('booking-1', actorUserId, {
        reference: 'VF-9999',
        amount: 100.0,
      })) as Record<string, unknown>;

      expect(res.paymentStatus).toBe('PAID');
      expect(res.paymentReference).toBe('VF-9999');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'booking.verify_payment',
          actorUserId,
          resourceId: 'booking-1',
        }),
      );
    });

    it('rejects verification with 400 PAYMENT_AMOUNT_MISMATCH if amounts differ', async () => {
      const { service } = setupService({
        bookingFindUnique: {
          id: 'booking-1',
          totalAmount: 100.0,
          paymentStatus: 'PENDING',
        },
      });

      await expect(
        service.verifyPayment('booking-1', actorUserId, {
          reference: 'VF-9999',
          amount: 80.0,
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({ code: 'PAYMENT_AMOUNT_MISMATCH' }),
      });
    });

    it('rejects verification with 409 PAYMENT_ALREADY_SETTLED if already PAID', async () => {
      const { service } = setupService({
        bookingFindUnique: {
          id: 'booking-1',
          totalAmount: 100.0,
          paymentStatus: 'PAID',
        },
      });

      await expect(
        service.verifyPayment('booking-1', actorUserId, {
          reference: 'VF-9999',
          amount: 100.0,
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({ code: 'PAYMENT_ALREADY_SETTLED' }),
      });
    });

    it('marks pending payment as FAILED', async () => {
      const { service, mockAudit } = setupService({
        bookingFindUnique: {
          id: 'booking-1',
          paymentStatus: 'PENDING',
        },
      });

      const res = (await service.failPayment('booking-1', actorUserId, {
        reason: 'Reference not found in wallet statement',
      })) as Record<string, unknown>;

      expect(res.paymentStatus).toBe('FAILED');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'booking.fail_payment',
        }),
      );
    });

    it('rejects failing a payment that is already PAID', async () => {
      const { service } = setupService({
        bookingFindUnique: {
          id: 'booking-1',
          paymentStatus: 'PAID',
        },
      });

      await expect(
        service.failPayment('booking-1', actorUserId, {
          reason: 'Chargeback',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({ code: 'PAYMENT_ALREADY_SETTLED' }),
      });
    });
  });

  describe('US4: processRefund (cumulative refund tracking)', () => {
    it('processes partial refund and updates refundedAmount with PARTIALLY_REFUNDED status', async () => {
      const { service, mockAudit } = setupService({
        bookingFindUnique: {
          id: 'booking-1',
          totalAmount: 100.0,
          refundedAmount: 0.0,
          paymentMethod: 'VODAFONE_CASH',
          paymentStatus: 'PAID',
        },
      });

      const res = (await service.processRefund('booking-1', actorUserId, {
        refundReference: 'REF-1',
        refundAmount: 40.0,
        reason: 'Passenger cancelled 1 of 2 seats',
      })) as Record<string, unknown>;

      expect(res.paymentStatus).toBe('PARTIALLY_REFUNDED');
      expect(res.remainingRefundableBalance).toBe('60.00');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'booking.refund',
        }),
      );
    });

    it('processes full refund setting REFUNDED status when balance reaches zero', async () => {
      const { service } = setupService({
        bookingFindUnique: {
          id: 'booking-1',
          totalAmount: 100.0,
          refundedAmount: 60.0,
          paymentMethod: 'VODAFONE_CASH',
          paymentStatus: 'PARTIALLY_REFUNDED',
        },
      });

      const res = (await service.processRefund('booking-1', actorUserId, {
        refundReference: 'REF-2',
        refundAmount: 40.0,
        reason: 'Remaining seat refund',
      })) as Record<string, unknown>;

      expect(res.paymentStatus).toBe('REFUNDED');
      expect(res.remainingRefundableBalance).toBe('0.00');
    });

    it('rejects refund exceeding remaining balance with 400 REFUND_EXCEEDS_BALANCE', async () => {
      const { service } = setupService({
        bookingFindUnique: {
          id: 'booking-1',
          totalAmount: 100.0,
          refundedAmount: 80.0,
          paymentMethod: 'VODAFONE_CASH',
          paymentStatus: 'PARTIALLY_REFUNDED',
        },
      });

      await expect(
        service.processRefund('booking-1', actorUserId, {
          refundReference: 'REF-3',
          refundAmount: 50.0,
          reason: 'Excess refund',
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({ code: 'REFUND_EXCEEDS_BALANCE' }),
      });
    });

    it('rejects electronic refund on unpaid cash booking with 400 REFUND_NOT_ELIGIBLE', async () => {
      const { service } = setupService({
        bookingFindUnique: {
          id: 'booking-1',
          totalAmount: 50.0,
          refundedAmount: 0.0,
          paymentMethod: 'CASH',
          paymentStatus: 'PENDING',
        },
      });

      await expect(
        service.processRefund('booking-1', actorUserId, {
          refundReference: 'REF-CASH',
          refundAmount: 50.0,
          reason: 'No money collected',
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({ code: 'REFUND_NOT_ELIGIBLE' }),
      });
    });
  });

  describe('US5: forceCancel & reinstate (administrative capacity control)', () => {
    it('force-cancels booking and sets REFUND_PENDING for settled payment', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      const { service, mockAudit } = setupService({
        bookingFindUnique: {
          id: 'booking-1',
          tripId: 'trip-1',
          status: 'CONFIRMED',
          paymentStatus: 'PAID',
          seats: 2,
          trip: { departAt: futureDate },
        },
      });

      const res = (await service.forceCancel('booking-1', actorUserId, {
        reason: 'Emergency route maintenance',
        releaseSeats: true,
      })) as Record<string, unknown>;

      expect(res.status).toBe('CANCELLED');
      expect(res.paymentStatus).toBe('REFUND_PENDING');
      expect(res.seatsRestored).toBe(true);
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'booking.force_cancel',
        }),
      );
    });

    it('rejects force-cancellation of already cancelled booking with 409 BOOKING_ALREADY_CANCELLED', async () => {
      const { service } = setupService({
        bookingFindUnique: {
          id: 'booking-1',
          status: 'CANCELLED',
        },
      });

      await expect(
        service.forceCancel('booking-1', actorUserId, {
          reason: 'Again',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          code: 'BOOKING_ALREADY_CANCELLED',
        }),
      });
    });

    it('reinstates cancelled booking when trip has available seats', async () => {
      const { service, mockAudit } = setupService({
        bookingFindUnique: {
          id: 'booking-1',
          tripId: 'trip-1',
          status: 'CANCELLED',
          seats: 2,
        },
        txQueryRaw: [{ id: 'trip-1', capacity: 14 }],
        bookingAggregate: { _sum: { seats: 10 } }, // 14 - 10 = 4 available >= 2 requested
      });

      const res = (await service.reinstate('booking-1', actorUserId, {
        reason: 'Passenger confirmed travel after mistake',
      })) as Record<string, unknown>;

      expect(res.status).toBe('CONFIRMED');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'booking.reinstate',
        }),
      );
    });

    it('rejects reinstatement with 409 SEATS_UNAVAILABLE when trip capacity is insufficient', async () => {
      const { service } = setupService({
        bookingFindUnique: {
          id: 'booking-1',
          tripId: 'trip-1',
          status: 'CANCELLED',
          seats: 3,
        },
        txQueryRaw: [{ id: 'trip-1', capacity: 14 }],
        bookingAggregate: { _sum: { seats: 13 } }, // only 1 seat available, 3 requested
      });

      await expect(
        service.reinstate('booking-1', actorUserId, {
          reason: 'Try reinstate',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          code: 'SEATS_UNAVAILABLE',
          details: expect.objectContaining({
            availableSeats: 1,
            requestedSeats: 3,
          }),
        }),
      });
    });
  });

  describe('US6: overrideOperational & resolveReport', () => {
    it('updates operational boarding and drop-off state with justification', async () => {
      const { service, mockAudit } = setupService({
        bookingFindUnique: {
          id: 'booking-1',
          boardedAt: null,
          dropStatus: null,
        },
      });

      const res = (await service.overrideOperational('booking-1', actorUserId, {
        boarded: true,
        dropStatus: 'DROPPED_OFF',
        dropStationId: 'station-auc',
        justification: 'Driver app crashed during trip',
      })) as Record<string, unknown>;

      expect(res.dropStatus).toBe('DROPPED_OFF');
      expect(res.dropStationId).toBe('station-auc');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'booking.override_operational',
        }),
      );
    });

    it('rejects operational override without justification', async () => {
      const { service } = setupService({
        bookingFindUnique: { id: 'booking-1' },
      });

      await expect(
        service.overrideOperational('booking-1', actorUserId, {
          boarded: true,
          justification: '   ',
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({ code: 'JUSTIFICATION_REQUIRED' }),
      });
    });

    it('resolves passenger incident report with resolution note', async () => {
      const { service, mockAudit } = setupService({
        reportFindUnique: {
          id: 'report-1',
          bookingId: 'booking-1',
          driverId: 'driver-1',
          passengerId: 'passenger-1',
          note: 'Passenger dispute',
          status: 'PENDING',
        },
      });

      const res = (await service.resolveReport(
        'booking-1',
        'report-1',
        actorUserId,
        {
          status: 'RESOLVED',
          resolutionNote: 'Clarified terms of carriage with passenger',
        },
      )) as Record<string, unknown>;

      expect(res.status).toBe('RESOLVED');
      expect(res.resolutionNote).toBe(
        'Clarified terms of carriage with passenger',
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'report.resolve',
        }),
      );
    });

    it('rejects resolving report that does not belong to booking with 404 REPORT_NOT_FOUND', async () => {
      const { service } = setupService({
        reportFindUnique: {
          id: 'report-1',
          bookingId: 'other-booking-id',
          status: 'PENDING',
        },
      });

      await expect(
        service.resolveReport('booking-1', 'report-1', actorUserId, {
          status: 'RESOLVED',
          resolutionNote: 'Note',
        }),
      ).rejects.toMatchObject({
        status: 404,
        response: expect.objectContaining({ code: 'REPORT_NOT_FOUND' }),
      });
    });
  });
});
