import { Injectable, NotFoundException } from '@nestjs/common';
import { FleetPathService } from '../authorization/services/fleet-path.service.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import { translatePrismaError } from '../common/prisma-error.util.js';
import {
  buildCursorArgs,
  toCursorPage,
  type CursorPage,
} from '../common/pagination.js';
import type { Prisma, Trip } from '../generated/prisma/client.js';
import type {
  TripDetailsResponseDto,
  TripSearchQueryDto,
  TripSearchResultItemDto,
} from './dto/trip-search.dto.js';

export interface CreateTripInput {
  busId: string;
  origin: string;
  destination: string;
  departAt: string;
  status?: string;
  routeId?: string;
  fare?: string;
}

export interface UpdateTripInput {
  origin?: string;
  destination?: string;
  departAt?: string;
  status?: string;
  routeId?: string;
  fare?: string;
}

/** Fleet-owned trip CRUD. The bus must belong to the same fleet (spec §4 ownership path). */
@Injectable()
export class TripsService {
  constructor(
    private readonly fleetPath: FleetPathService,
    private readonly system: SystemPrismaService,
  ) {}

  create(
    actor: RequestUser,
    fleetContext: FleetContext,
    input: CreateTripInput,
  ): Promise<Trip> {
    const createTrip = async (tx: Prisma.TransactionClient): Promise<Trip> => {
      const where =
        fleetContext.membershipId === null
          ? { id: input.busId, fleetId: fleetContext.fleetId }
          : { id: input.busId };
      const bus = await tx.bus.findFirst({ where });
      if (!bus) throw new NotFoundException('Bus not found in this fleet');
      return tx.trip
        .create({
          data: {
            ...input,
            departAt: new Date(input.departAt),
            fleetId: fleetContext.fleetId,
          },
        })
        .catch((error) => {
          throw translatePrismaError(error, 'Trip');
        });
    };

    return this.fleetPath.run(actor, fleetContext, createTrip, createTrip);
  }

  async findAll(
    actor: RequestUser,
    fleetContext: FleetContext,
    query: { cursor?: string; limit?: string },
  ): Promise<CursorPage<Trip>> {
    const { pageSize, ...args } = buildCursorArgs(query);
    const trips = await this.fleetPath.run(
      actor,
      fleetContext,
      (tx) =>
        tx.trip.findMany({ ...args, orderBy: { departAt: 'desc' as const } }),
      (tx) =>
        tx.trip.findMany({
          where: { fleetId: fleetContext.fleetId },
          ...args,
          orderBy: { departAt: 'desc' as const },
        }),
    );
    return toCursorPage(trips, pageSize);
  }

  async findOne(
    actor: RequestUser,
    fleetContext: FleetContext,
    id: string,
  ): Promise<Trip> {
    const trip = await this.fleetPath.run(
      actor,
      fleetContext,
      (tx) => tx.trip.findUnique({ where: { id } }),
      (tx) =>
        tx.trip.findFirst({ where: { id, fleetId: fleetContext.fleetId } }),
    );
    if (!trip) throw new NotFoundException('Trip not found');
    return trip;
  }

  async update(
    actor: RequestUser,
    fleetContext: FleetContext,
    id: string,
    input: UpdateTripInput,
  ): Promise<Trip> {
    await this.findOne(actor, fleetContext, id);
    return this.fleetPath.run(
      actor,
      fleetContext,
      (tx) =>
        tx.trip.update({
          where: { id },
          data: {
            ...input,
            ...(input.departAt ? { departAt: new Date(input.departAt) } : {}),
          },
        }),
      (tx) => tx.trip.update({ where: { id }, data: input }),
    );
  }

  async remove(
    actor: RequestUser,
    fleetContext: FleetContext,
    id: string,
  ): Promise<void> {
    await this.findOne(actor, fleetContext, id);
    await this.fleetPath.run(
      actor,
      fleetContext,
      (tx) => tx.trip.delete({ where: { id } }),
      (tx) => tx.trip.delete({ where: { id } }),
    );
  }

  /**
   * Public search for scheduled microbus trips with live available seat counts (spec 004 US1).
   * Strict calendar day matching (returns [] when none match).
   */
  async searchTrips(
    query: TripSearchQueryDto,
  ): Promise<CursorPage<TripSearchResultItemDto>> {
    const { pageSize, ...cursorArgs } = buildCursorArgs({
      cursor: query.cursor,
      limit: query.limit !== undefined ? String(query.limit) : undefined,
    });

    const dayStart = new Date(`${query.date}T00:00:00.000Z`);
    const dayEnd = new Date(`${query.date}T23:59:59.999Z`);

    const trips = await this.system.trip.findMany({
      where: {
        origin: { equals: query.origin, mode: 'insensitive' },
        destination: { equals: query.destination, mode: 'insensitive' },
        status: 'SCHEDULED',
        departAt: {
          gte: dayStart,
          lte: dayEnd,
        },
      },
      ...cursorArgs,
      orderBy: { departAt: 'asc' },
      include: {
        bus: {
          select: {
            id: true,
            plateNumber: true,
            capacity: true,
          },
        },
        route: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        bookings: {
          where: { status: 'CONFIRMED' },
          select: { seats: true },
        },
      },
    });

    const items: TripSearchResultItemDto[] = trips.map((t) => {
      const bookedSeats = t.bookings.reduce((sum, b) => sum + b.seats, 0);
      const capacity = t.bus?.capacity ?? 0;
      const availableSeats = Math.max(0, capacity - bookedSeats);

      return {
        id: t.id,
        routeId: t.routeId,
        routeName: t.route?.name ?? null,
        origin: t.origin,
        destination: t.destination,
        departAt: t.departAt,
        fare: Number(t.fare).toFixed(2),
        status: t.status,
        capacity,
        availableSeats,
        paymentMethods: ['CASH', 'VODAFONE_CASH'],
        bus: {
          plateNumber: t.bus?.plateNumber ?? '',
        },
      };
    });

    return toCursorPage(items, pageSize);
  }

  /**
   * Public retrieval of comprehensive trip details including ordered stopping stations (spec 004 US1).
   */
  async findTripDetails(id: string): Promise<TripDetailsResponseDto> {
    const trip = await this.system.trip.findUnique({
      where: { id },
      include: {
        bus: {
          select: {
            id: true,
            plateNumber: true,
            registrationNumber: true,
            capacity: true,
          },
        },
        route: {
          select: {
            id: true,
            name: true,
            code: true,
            stations: {
              orderBy: { stopOrder: 'asc' },
              select: {
                stopOrder: true,
                estimatedStopMinutes: true,
                station: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        bookings: {
          where: { status: 'CONFIRMED' },
          select: { seats: true },
        },
      },
    });

    if (!trip || trip.status === 'CANCELLED') {
      throw new CodedException(404, 'TRIP_NOT_FOUND', 'Trip not found.');
    }

    const bookedSeats = trip.bookings.reduce((sum, b) => sum + b.seats, 0);
    const capacity = trip.bus?.capacity ?? 0;
    const availableSeats = Math.max(0, capacity - bookedSeats);

    return {
      id: trip.id,
      origin: trip.origin,
      destination: trip.destination,
      departAt: trip.departAt,
      fare: Number(trip.fare).toFixed(2),
      status: trip.status,
      capacity,
      availableSeats,
      paymentMethods: ['CASH', 'VODAFONE_CASH'],
      route: trip.route
        ? {
            id: trip.route.id,
            name: trip.route.name,
            code: trip.route.code,
            stations: trip.route.stations.map((s) => ({
              id: s.station.id,
              name: s.station.name,
              stopOrder: s.stopOrder,
              estimatedStopMinutes: s.estimatedStopMinutes,
            })),
          }
        : null,
      bus: {
        id: trip.bus?.id ?? '',
        plateNumber: trip.bus?.plateNumber ?? '',
        registrationNumber: trip.bus?.registrationNumber ?? null,
      },
    };
  }
}
