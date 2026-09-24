import { Injectable } from '@nestjs/common';
import { CodedException } from '../common/filters/coded.exception.js';
import {
  buildCursorArgs,
  toCursorPage,
  type CursorPage,
} from '../common/pagination.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';

const fleetSearchInclude = {
  owner: { select: { id: true, name: true, nickname: true } },
  vipTier: { select: { id: true, name: true, rank: true } },
} satisfies Prisma.FleetInclude;

type FleetSearchRow = Prisma.FleetGetPayload<{
  include: typeof fleetSearchInclude;
}>;

export type FleetOwnerSearchItem = {
  id: string;
  name: string;
  ownerName: string | null;
  vipTier: { id: string; name: string; rank: number } | null;
};

const busDiscoveryInclude = {
  brand: true,
  assignments: {
    where: { status: 'ACTIVE' },
    select: {
      driver: { select: { id: true, name: true, phoneNumber: true } },
    },
    take: 1,
  },
} satisfies Prisma.BusInclude;

/**
 * Passenger discovery funnel (spec 008). Reads platform catalog and fleet
 * directory data through the system path — fleets carry no per-passenger
 * tenant context, and RLS is fleet-member-scoped by design. No seat
 * availability filtering here; bookability stays in the trip-search funnel.
 */
@Injectable()
export class DiscoveryService {
  constructor(private readonly system: SystemPrismaService) {}

  async searchFleetOwners(query: {
    q?: string;
    cursor?: string;
    limit?: string;
  }): Promise<CursorPage<FleetOwnerSearchItem>> {
    const { pageSize, ...args } = buildCursorArgs(query);
    const term = query.q?.trim();
    const contains = term
      ? { contains: term, mode: 'insensitive' as const }
      : undefined;

    const geoFilter = contains
      ? {
          trips: {
            some: {
              route: {
                stations: {
                  some: {
                    station: {
                      OR: [
                        { name: contains },
                        { address: contains },
                        {
                          locality: {
                            OR: [
                              { nameAr: contains },
                              { nameEn: contains },
                              {
                                markaz: {
                                  OR: [
                                    { nameAr: contains },
                                    { nameEn: contains },
                                    {
                                      governorate: {
                                        OR: [
                                          { nameAr: contains },
                                          { nameEn: contains },
                                          { code: contains },
                                        ],
                                      },
                                    },
                                  ],
                                },
                              },
                            ],
                          },
                        },
                        {
                          governorate: {
                            OR: [
                              { nameAr: contains },
                              { nameEn: contains },
                              { code: contains },
                            ],
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        }
      : undefined;

    const rows = await this.system.fleet.findMany({
      ...args,
      where: {
        isActive: true,
        owner: { isActive: true },
        ...(contains
          ? {
              OR: [
                { name: contains },
                { owner: { name: contains } },
                { owner: { nickname: contains } },
                geoFilter!,
              ],
            }
          : undefined),
      },
      orderBy: [{ vipTier: { rank: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
      include: fleetSearchInclude,
    });
    return toCursorPage(rows.map((row) => this.present(row)), pageSize);
  }

  async fleetBuses(fleetId: string) {
    const fleet = await this.system.fleet.findFirst({
      where: { id: fleetId, isActive: true, owner: { isActive: true } },
      select: { id: true },
    });
    if (!fleet) {
      throw new CodedException(
        404,
        'FLEET_NOT_FOUND',
        'Fleet not found.',
      );
    }
    const buses = await this.system.bus.findMany({
      where: { fleetId, isActive: true },
      orderBy: { registrationNumber: 'asc' },
      include: busDiscoveryInclude,
    });
    return buses.map((bus) => ({
      id: bus.id,
      fleetId: bus.fleetId,
      registrationNumber: bus.registrationNumber,
      plateNumber: bus.plateNumber,
      color: bus.color,
      imageUrl: bus.imageUrl,
      brandId: bus.brandId,
      brand: bus.brand,
      capacity: bus.capacity,
      isAirConditioned: bus.isAirConditioned,
      modelYear: bus.modelYear,
      driver: bus.assignments[0]?.driver ?? null,
    }));
  }

  private present(row: FleetSearchRow): FleetOwnerSearchItem {
    return {
      id: row.id,
      name: row.name,
      ownerName: row.owner.name ?? row.owner.nickname,
      vipTier: row.vipTier,
    };
  }
}
