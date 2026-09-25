import { Injectable } from '@nestjs/common';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import {
  buildCursorArgs,
  toCursorPage,
  type CursorPage,
} from '../common/pagination.js';
import { CodedException } from '../common/filters/coded.exception.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { AdminBookingQueryDto } from './dto/admin-booking.dto.js';
import type {
  AdminBookingDetailDto,
  AdminBookingListItemDto,
} from './dto/admin-booking-response.dto.js';

@Injectable()
export class AdminBookingsQueryService {
  constructor(private readonly system: SystemPrismaService) {}

  async findAll(
    query: AdminBookingQueryDto,
  ): Promise<CursorPage<AdminBookingListItemDto>> {
    const { pageSize, ...cursorArgs } = buildCursorArgs(query);

    const where: Prisma.BookingWhereInput = {};

    if (query.fleetId) where.fleetId = query.fleetId;
    if (query.tripId) where.tripId = query.tripId;
    if (query.passengerUserId) where.passengerUserId = query.passengerUserId;
    if (query.status) where.status = query.status;
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;

    if (query.passengerPhone) {
      where.passengerPhone = {
        contains: query.passengerPhone,
        mode: 'insensitive',
      };
    }
    if (query.passengerName) {
      where.passengerName = {
        contains: query.passengerName,
        mode: 'insensitive',
      };
    }

    if (query.createdFrom || query.createdTo) {
      where.createdAt = {};
      if (query.createdFrom) where.createdAt.gte = new Date(query.createdFrom);
      if (query.createdTo) where.createdAt.lte = new Date(query.createdTo);
    }

    if (query.departureFrom || query.departureTo) {
      where.trip = where.trip || {};
      where.trip.departAt = {};
      if (query.departureFrom)
        where.trip.departAt.gte = new Date(query.departureFrom);
      if (query.departureTo)
        where.trip.departAt.lte = new Date(query.departureTo);
    }

    if (query.hasReports) {
      where.reports = { some: {} };
    }

    const rows = await this.system.booking.findMany({
      ...cursorArgs,
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        fleet: { select: { id: true, name: true } },
        trip: {
          select: { id: true, departAt: true, origin: true, destination: true },
        },
        reports: { select: { id: true } },
      },
    });

    const items: AdminBookingListItemDto[] = rows.map((r) => ({
      id: r.id,
      fleetId: r.fleetId,
      fleetName: r.fleet.name,
      tripId: r.tripId,
      passengerName: r.passengerName,
      passengerPhone: r.passengerPhone,
      passengerUserId: r.passengerUserId,
      bookingFor: r.bookingFor,
      note: r.note,
      seats: r.seats,
      status: r.status,
      totalAmount: r.totalAmount?.toString() ?? null,
      promoCode: r.promoCode,
      discountAmount: Number(r.discountAmount ?? 0).toFixed(2),
      refundedAmount: r.refundedAmount.toString(),
      paymentMethod: r.paymentMethod,
      paymentStatus: r.paymentStatus,
      paymentReference: r.paymentReference,
      boardedAt: r.boardedAt,
      dropStatus: r.dropStatus,
      hasReports: r.reports.length > 0,
      tripDepartureTime: r.trip.departAt,
      originName: r.trip.origin,
      destinationName: r.trip.destination,
      confirmedAt: r.confirmedAt,
      createdAt: r.createdAt,
    }));

    return toCursorPage(items, pageSize);
  }

  async findOne(id: string): Promise<AdminBookingDetailDto> {
    const booking = await this.system.booking.findUnique({
      where: { id },
      include: {
        fleet: { select: { id: true, name: true } },
        passenger: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            phoneVerifiedAt: true,
            picture: true,
          },
        },
        trip: {
          include: {
            bus: {
              select: {
                id: true,
                registrationNumber: true,
                capacity: true,
                assignments: {
                  where: { status: 'ACTIVE' },
                  take: 1,
                  include: {
                    driver: {
                      select: { id: true, name: true, phoneNumber: true },
                    },
                  },
                },
              },
            },
            route: {
              include: {
                stations: {
                  orderBy: { stopOrder: 'asc' },
                  include: { station: true },
                },
              },
            },
          },
        },
        reports: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!booking) {
      throw new CodedException(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    }

    const [bookedSeatsAgg, auditTrail] = await Promise.all([
      this.system.booking.aggregate({
        where: { tripId: booking.tripId, status: 'CONFIRMED' },
        _sum: { seats: true },
      }),
      this.system.auditLog.findMany({
        where: {
          resource: 'bookings',
          resourceId: id,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const bookedSeats = bookedSeatsAgg._sum.seats ?? 0;
    const availableSeats = Math.max(0, booking.trip.bus.capacity - bookedSeats);

    const activeAssignment = booking.trip.bus.assignments[0];
    const driver = activeAssignment
      ? {
          id: activeAssignment.driver.id,
          name: activeAssignment.driver.name,
          phoneNumber: activeAssignment.driver.phoneNumber,
        }
      : null;

    let boardingStationName =
      booking.trip.route?.stations.find(
        (s) => s.stationId === booking.boardingStationId,
      )?.station.name ?? null;

    let landingStationName =
      booking.trip.route?.stations.find(
        (s) => s.stationId === booking.landingStationId,
      )?.station.name ?? null;

    if (
      (booking.boardingStationId && !boardingStationName) ||
      (booking.landingStationId && !landingStationName)
    ) {
      const missingIds: string[] = [];
      if (booking.boardingStationId && !boardingStationName) {
        missingIds.push(booking.boardingStationId);
      }
      if (booking.landingStationId && !landingStationName) {
        missingIds.push(booking.landingStationId);
      }

      if (
        missingIds.length > 0 &&
        typeof (this.system as unknown as { station?: { findMany?: unknown } })
          .station?.findMany === 'function'
      ) {
        const found = await this.system.station.findMany({
          where: { id: { in: missingIds } },
          select: { id: true, name: true },
        });
        for (const st of found) {
          if (st.id === booking.boardingStationId) boardingStationName = st.name;
          if (st.id === booking.landingStationId) landingStationName = st.name;
        }
      }
    }

    return {
      id: booking.id,
      fleetId: booking.fleetId,
      fleetName: booking.fleet.name,
      status: booking.status,
      seats: booking.seats,
      passengerName: booking.passengerName,
      passengerPhone: booking.passengerPhone,
      passengerUserId: booking.passengerUserId,
      bookingFor: booking.bookingFor,
      note: booking.note,
      boardingStationId: booking.boardingStationId,
      landingStationId: booking.landingStationId,
      boardingStationName,
      landingStationName,
      totalAmount: booking.totalAmount?.toString() ?? null,
      promoCode: booking.promoCode,
      discountAmount: Number(booking.discountAmount ?? 0).toFixed(2),
      refundedAmount: booking.refundedAmount.toString(),
      paymentMethod: booking.paymentMethod,
      paymentStatus: booking.paymentStatus,
      paymentReference: booking.paymentReference,
      paymentNotes: booking.paymentNotes,
      paidAt: booking.paidAt,
      paymentMarkedBy: booking.paymentMarkedBy,
      confirmedAt: booking.confirmedAt,
      cancelledAt: booking.cancelledAt,
      cancelledBy: booking.cancelledBy,
      cancellationReason: booking.cancellationReason,
      boardedAt: booking.boardedAt,
      boardedBy: booking.boardedBy,
      dropStatus: booking.dropStatus,
      dropStationId: booking.dropStationId,
      dropReason: booking.dropReason,
      passenger: booking.passenger,
      trip: {
        id: booking.trip.id,
        departureTime: booking.trip.departAt,
        originName: booking.trip.origin,
        destinationName: booking.trip.destination,
        fare: booking.trip.fare.toString(),
        status: booking.trip.status,
        availableSeats,
        bus: {
          id: booking.trip.bus.id,
          registrationNumber: booking.trip.bus.registrationNumber,
          capacity: booking.trip.bus.capacity,
        },
        driver,
        route: booking.trip.route,
      },
      reports: booking.reports,
      ratings: {
        busRating: booking.busRating,
        driverRating: booking.driverRating,
        passengerRating: booking.passengerRating,
      },
      auditTrail: auditTrail.map((a) => ({
        id: a.id,
        action: a.action,
        actorUserId: a.actorUserId,
        metadata: a.metadata,
        createdAt: a.createdAt,
      })),
    };
  }
}
