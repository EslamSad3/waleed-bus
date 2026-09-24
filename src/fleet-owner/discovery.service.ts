import { Injectable } from '@nestjs/common';
import { CodedException } from '../common/filters/coded.exception.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';

const fleetSearchInclude = {
  owner: { select: { id: true, name: true, nickname: true } },
  vipTier: { select: { id: true, name: true, rank: true } },
} satisfies Prisma.FleetInclude;

export type FleetOwnerSearchFleet = {
  id: string;
  name: string;
  vipTier: { id: string; name: string; rank: number } | null;
};

/**
 * One item per fleet OWNER (call §§13-14: "Group results by fleet owner").
 * An owner with N fleets appears exactly once with nested fleets; vipRank is
 * the best (min) tier rank across their fleets, null when untiered.
 */
export type FleetOwnerSearchItem = {
  fleetOwnerId: string;
  fleetOwnerName: string | null;
  vipRank: number | null;
  fleets: FleetOwnerSearchFleet[];
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

  /**
   * Owner-grouped directory search (call §§13-15). Fleets match on fleet
   * name, owner name/nickname, or route geography; results collapse to one
   * item per owner ordered by best VIP rank (untiered last), then owner name.
   * The directory is small and search-scoped, so grouping runs in memory over
   * a bounded fleet fetch instead of cursor pagination.
   */
  async searchFleetOwners(query: {
    q?: string;
    limit?: string;
  }): Promise<{ items: FleetOwnerSearchItem[] }> {
    const rawLimit = Number(query.limit);
    const pageSize =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), 100)
        : 20;
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
      take: pageSize * 5,
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
      // Note: PostgreSQL ASC sorts NULLS LAST, so untiered fleets trail
      // ranked ones; the owner-level sort below is explicitly nulls-last.
      orderBy: [{ vipTier: { rank: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
      include: fleetSearchInclude,
    });

    const groups = new Map<string, FleetOwnerSearchItem>();
    for (const row of rows) {
      let group = groups.get(row.owner.id);
      if (!group) {
        group = {
          fleetOwnerId: row.owner.id,
          fleetOwnerName: row.owner.name ?? row.owner.nickname,
          vipRank: null,
          fleets: [],
        };
        groups.set(row.owner.id, group);
      }
      group.fleets.push({ id: row.id, name: row.name, vipTier: row.vipTier });
      if (row.vipTier && (group.vipRank === null || row.vipTier.rank < group.vipRank)) {
        group.vipRank = row.vipTier.rank;
      }
    }
    const items = [...groups.values()]
      .sort((a, b) => {
        if (a.vipRank === null && b.vipRank === null) return 0;
        if (a.vipRank === null) return 1;
        if (b.vipRank === null) return -1;
        if (a.vipRank !== b.vipRank) return a.vipRank - b.vipRank;
        return (a.fleetOwnerName ?? '').localeCompare(b.fleetOwnerName ?? '');
      })
      .slice(0, pageSize);
    return { items };
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
}
