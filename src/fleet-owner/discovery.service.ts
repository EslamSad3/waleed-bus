import { Injectable } from '@nestjs/common';
import { CodedException } from '../common/filters/coded.exception.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';

const fleetSearchInclude = {
  owner: { select: { id: true, name: true, nickname: true } },
  vipTier: { select: { id: true, name: true, rank: true, isActive: true } },
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
   *
   * Two-stage selection (correct first-N owners, no window heuristic):
   *  1. load ALL matching fleets as light (ownerId + tier rank) rows,
   *     derive distinct owners with best-rank ordering in memory;
   *  2. fetch full fleet rows for exactly the chosen owners.
   * The directory is small and search-scoped, so the bounded full-match scan
   * keeps grouping exact; the response itself is capped at `limit` owners.
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

    const matchWhere: Prisma.FleetWhereInput = {
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
    };

    // Stage 1: every matching fleet as a light row — no take-window, so no
    // owner can be crowded out by another owner's fleet count.
    const matches = await this.system.fleet.findMany({
      where: matchWhere,
      select: {
        ownerId: true,
        vipTier: { select: { rank: true, isActive: true } },
      },
    });
    const bestRank = new Map<string, number | null>();
    for (const row of matches) {
      // Inactive tiers are treated as untiered (explicit business rule).
      const rank =
        row.vipTier && row.vipTier.isActive ? row.vipTier.rank : null;
      const current = bestRank.get(row.ownerId);
      if (current === undefined || (rank !== null && (current === null || rank < current))) {
        bestRank.set(row.ownerId, rank);
      }
    }
    const owners = await this.system.user.findMany({
      where: { id: { in: [...bestRank.keys()] } },
      select: { id: true, name: true, nickname: true },
    });
    const chosen = owners
      .map((owner) => ({
        owner,
        rank: bestRank.get(owner.id) ?? null,
      }))
      .sort((a, b) => {
        if (a.rank === null && b.rank === null) return 0;
        if (a.rank === null) return 1;
        if (b.rank === null) return -1;
        if (a.rank !== b.rank) return a.rank - b.rank;
        const aName = a.owner.name ?? a.owner.nickname ?? '';
        const bName = b.owner.name ?? b.owner.nickname ?? '';
        return aName.localeCompare(bName);
      })
      .slice(0, pageSize);

    // Stage 2: full rows for exactly the chosen owners — nested fleets[] is
    // complete by construction.
    const rows = await this.system.fleet.findMany({
      where: { ...matchWhere, ownerId: { in: chosen.map((c) => c.owner.id) } },
      // Note: PostgreSQL ASC sorts NULLS LAST, so untiered fleets trail
      // ranked ones within an owner.
      orderBy: [{ vipTier: { rank: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
      include: fleetSearchInclude,
    });
    const byOwner = new Map(chosen.map((c) => [c.owner.id, c]));
    const groups = new Map<string, FleetOwnerSearchItem>();
    for (const id of chosen.map((c) => c.owner.id)) {
      const c = byOwner.get(id)!;
      groups.set(id, {
        fleetOwnerId: id,
        fleetOwnerName: c.owner.name ?? c.owner.nickname,
        vipRank: c.rank,
        fleets: [],
      });
    }
    for (const row of rows) {
      const tier = row.vipTier && row.vipTier.isActive ? row.vipTier : null;
      groups.get(row.ownerId)?.fleets.push({
        id: row.id,
        name: row.name,
        vipTier: tier
          ? { id: tier.id, name: tier.name, rank: tier.rank }
          : null,
      });
    }
    return { items: [...groups.values()] };
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
