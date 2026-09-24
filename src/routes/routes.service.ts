import { Injectable } from '@nestjs/common';
import { CodedException } from '../common/filters/coded.exception.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import type { PublicRouteResponseDto } from './dto/route.dto.js';
import { localityWithChain } from './geography.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class RoutesService {
  constructor(private readonly system: SystemPrismaService) {}

  /** Public, generic stop catalog. It deliberately exposes no fleet data. */
  async listPublicStops() {
    const stops = await this.system.station.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, address: true, latitude: true, longitude: true, governorate: true, locality: { include: localityWithChain } },
    });
    return stops.map((stop) => ({
      ...stop,
      latitude: stop.latitude === null ? null : Number(stop.latitude),
      longitude: stop.longitude === null ? null : Number(stop.longitude),
    }));
  }

  /**
   * Resolves a route, ordered stations, and upcoming scheduled trips from a QR identifier, code, or UUID (spec 004 US8).
   * Unauthenticated public endpoint.
   */
  async resolvePublicRoute(
    identifier: string,
  ): Promise<PublicRouteResponseDto> {
    const isUuid = UUID_REGEX.test(identifier);

    const route = await this.system.route.findFirst({
      where: {
        isActive: true,
        OR: [
          ...(isUuid ? [{ id: identifier }] : []),
          { code: identifier },
          { qrIdentifier: identifier },
        ],
      },
      include: {
        stations: {
          orderBy: { stopOrder: 'asc' },
          include: {
            station: { include: { governorate: true, locality: { include: localityWithChain } } },
          },
        },
      },
    });

    if (!route) {
      throw new CodedException(
        404,
        'ROUTE_NOT_FOUND',
        'Route not found for the provided identifier.',
      );
    }

    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 3600 * 1000);

    const upcomingTrips = await this.system.trip.findMany({
      where: {
        routeId: route.id,
        status: 'SCHEDULED',
        departAt: {
          gte: now,
          lte: in48h,
        },
      },
      orderBy: {
        departAt: 'asc',
      },
      include: {
        bus: {
          select: {
            capacity: true,
            plateNumber: true,
          },
        },
        bookings: {
          where: { status: 'CONFIRMED' },
          select: { seats: true },
        },
      },
    });

    const stations = route.stations.map((rs) => ({
      id: rs.station.id,
      name: rs.station.name,
      address: rs.station.address,
      latitude: rs.station.latitude ? Number(rs.station.latitude) : null,
      longitude: rs.station.longitude ? Number(rs.station.longitude) : null,
      governorate: rs.station.governorate,
      locality: rs.station.locality,
      stopOrder: rs.stopOrder,
      estimatedStopMinutes: rs.estimatedStopMinutes,
    }));

    const mappedTrips = upcomingTrips.map((t) => {
      const bookedSeats = t.bookings.reduce((sum, b) => sum + b.seats, 0);
      const availableSeats = Math.max(0, t.bus.capacity - bookedSeats);

      return {
        id: t.id,
        departAt: t.departAt,
        fare: Number(t.fare).toFixed(2),
        capacity: t.bus.capacity,
        availableSeats,
        bus: {
          plateNumber: t.bus.plateNumber,
        },
      };
    });

    return {
      id: route.id,
      name: route.name,
      code: route.code,
      origin: route.origin,
      destination: route.destination,
      qrIdentifier: route.qrIdentifier,
      stations,
      upcomingTrips: mappedTrips,
    };
  }
}
