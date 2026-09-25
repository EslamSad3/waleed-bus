import { Injectable } from '@nestjs/common';
import type { RequestUser } from '../auth/jwt-payload.js';
import { CodedException } from '../common/filters/coded.exception.js';
import {
  buildCursorArgs,
  toCursorPage,
  type CursorPage,
} from '../common/pagination.js';
import type { Favorite } from '../generated/prisma/client.js';
import { SystemPrismaService } from '../prisma/prisma.module.js';
import type {
  CreateFavoriteDto,
  UpdateFavoriteDto,
} from './dto/favorite.dto.js';

export type FavoriteItem = {
  id: string;
  type: string;
  fleetId: string | null;
  busId: string | null;
  boardingStationId: string | null;
  landingStationId: string | null;
  createdAt: Date;
  fleet: { id: string; name: string; isActive: boolean } | null;
  bus: {
    id: string;
    fleetId: string;
    registrationNumber: string;
    plateNumber: string | null;
    isActive: boolean;
    fleetName: string;
    fleetActive: boolean;
  } | null;
  boardingStation: { id: string; name: string } | null;
  landingStation: { id: string; name: string } | null;
  isTargetActive: boolean;
};

/**
 * Passenger self-service favorites (spec 009). Passengers hold no fleet
 * membership, so the fleet-member-scoped tenant path cannot serve them;
 * every query uses the system path with strict actor.id scoping (same
 * justification family as passenger bookings). Foreign ids uniformly 404.
 *
 * Target references are scalar ids without FK constraints on purpose:
 * deleting a fleet/bus must never cascade-delete or block on a passenger's
 * private favorites; activity is resolved at read time instead.
 *
 * BUS rows keep fleetId NULL (fleet derived from the bus at read time):
 * storing the derived id would collide with FLEET rows under the
 * (userId, fleetId) unique constraint.
 */
@Injectable()
export class FavoritesService {
  constructor(private readonly system: SystemPrismaService) {}

  async createFavorite(
    actor: RequestUser,
    dto: CreateFavoriteDto,
  ): Promise<FavoriteItem> {
    await this.requireVerifiedPassenger(actor.id);
    const scopeFleetId = await this.resolveTarget(dto);
    await this.validateStopPrefs(
      scopeFleetId,
      dto.boardingStationId,
      dto.landingStationId,
    );
    const favorite = await this.system.favorite
      .create({
        data: {
          userId: actor.id,
          type: dto.type,
          fleetId: dto.type === 'FLEET' ? dto.fleetId! : null,
          busId: dto.type === 'BUS' ? dto.busId! : null,
          boardingStationId: dto.boardingStationId ?? null,
          landingStationId: dto.landingStationId ?? null,
        },
      })
      .catch((error: { code?: string }) => {
        if (error?.code === 'P2002') {
          throw new CodedException(
            409,
            'FAVORITE_ALREADY_EXISTS',
            'Already in favorites.',
          );
        }
        throw error;
      });
    return this.presentOne(favorite);
  }

  async listFavorites(
    actor: RequestUser,
    query: { cursor?: string; limit?: string },
  ): Promise<CursorPage<FavoriteItem>> {
    const { pageSize, ...args } = buildCursorArgs(query);
    const rows = await this.system.favorite.findMany({
      ...args,
      where: { userId: actor.id },
      orderBy: { createdAt: 'desc' },
    });
    const items = await this.presentMany(rows);
    return toCursorPage(items, pageSize);
  }

  async updateFavorite(
    actor: RequestUser,
    id: string,
    dto: UpdateFavoriteDto,
  ): Promise<FavoriteItem> {
    const existing = await this.getOwned(actor.id, id);
    const scopeFleetId = await this.scopeFor(existing);
    const boardingStationId =
      dto.boardingStationId !== undefined
        ? dto.boardingStationId
        : existing.boardingStationId;
    const landingStationId =
      dto.landingStationId !== undefined
        ? dto.landingStationId
        : existing.landingStationId;
    await this.validateStopPrefs(
      scopeFleetId,
      boardingStationId,
      landingStationId,
    );
    const updated = await this.system.favorite.update({
      where: { id },
      data: {
        ...(dto.boardingStationId !== undefined
          ? { boardingStationId: dto.boardingStationId }
          : undefined),
        ...(dto.landingStationId !== undefined
          ? { landingStationId: dto.landingStationId }
          : undefined),
      },
    });
    return this.presentOne(updated);
  }

  async deleteFavorite(actor: RequestUser, id: string): Promise<void> {
    await this.getOwned(actor.id, id);
    await this.system.favorite.delete({ where: { id } });
  }

  private async getOwned(userId: string, id: string) {
    const favorite = await this.system.favorite.findFirst({
      where: { id, userId },
    });
    if (!favorite) {
      throw new CodedException(404, 'FAVORITE_NOT_FOUND', 'Favorite not found.');
    }
    return favorite;
  }

  private async requireVerifiedPassenger(userId: string) {
    const caller = await this.system.user.findUnique({
      where: { id: userId },
    });
    if (!caller || !caller.phoneNumber || !caller.phoneVerifiedAt) {
      throw new CodedException(
        403,
        'PHONE_NOT_VERIFIED',
        'Verified phone number required.',
      );
    }
  }

  /** Validates the favorite target; returns the fleet scope for stop checks. */
  private async resolveTarget(dto: CreateFavoriteDto): Promise<string> {
    if (dto.type === 'FLEET') {
      if (!dto.fleetId) {
        throw new CodedException(
          400,
          'VALIDATION_FAILED',
          'fleetId is required for FLEET favorites.',
        );
      }
      const fleet = await this.system.fleet.findFirst({
        where: { id: dto.fleetId },
        select: { id: true, isActive: true, owner: { select: { isActive: true } } },
      });
      if (!fleet || !fleet.isActive || !fleet.owner.isActive) {
        throw new CodedException(
          422,
          'FAVORITE_TARGET_NOT_AVAILABLE',
          'This fleet cannot be favorited.',
        );
      }
      return fleet.id;
    }
    if (dto.type === 'BUS') {
      if (!dto.busId) {
        throw new CodedException(
          400,
          'VALIDATION_FAILED',
          'busId is required for BUS favorites.',
        );
      }
      const bus = await this.system.bus.findFirst({
        where: { id: dto.busId },
        select: {
          id: true,
          fleetId: true,
          isActive: true,
          fleet: { select: { isActive: true } },
        },
      });
      if (!bus || !bus.isActive || !bus.fleet.isActive) {
        throw new CodedException(
          422,
          'FAVORITE_TARGET_NOT_AVAILABLE',
          'This bus cannot be favorited.',
        );
      }
      return bus.fleetId;
    }
    throw new CodedException(
      400,
      'VALIDATION_FAILED',
      'Favorite type must be FLEET or BUS.',
    );
  }

  private async scopeFor(favorite: Favorite): Promise<string> {
    if (favorite.type === 'FLEET' && favorite.fleetId) return favorite.fleetId;
    if (favorite.type === 'BUS' && favorite.busId) {
      const bus = await this.system.bus.findFirst({
        where: { id: favorite.busId },
        select: { fleetId: true },
      });
      if (bus) return bus.fleetId;
    }
    if (favorite.fleetId) return favorite.fleetId;
    throw new CodedException(
      422,
      'FAVORITE_TARGET_NOT_AVAILABLE',
      'This favorite no longer has an active target.',
    );
  }

  /**
   * Stop prefs must reference active stations served by the favorite fleet:
   * a pair must share one of the fleet's trip routes with boarding before
   * landing and compatible stop types; a single stop must appear on at
   * least one of the fleet's trip routes.
   */
  private async validateStopPrefs(
    fleetId: string,
    boardingStationId: string | null | undefined,
    landingStationId: string | null | undefined,
  ): Promise<void> {
    if (!boardingStationId && !landingStationId) return;
    const wanted = [boardingStationId, landingStationId].filter(
      (id): id is string => Boolean(id),
    );
    const stations = await this.system.station.findMany({
      where: { id: { in: wanted } },
      select: { id: true, isActive: true },
    });
    const active = new Map(
      stations.filter((s) => s.isActive).map((s) => [s.id, s]),
    );
    if (
      (boardingStationId && !active.has(boardingStationId)) ||
      (landingStationId && !active.has(landingStationId))
    ) {
      throw new CodedException(
        422,
        'INVALID_FAVORITE_STOPS',
        'Chosen stops are not available.',
      );
    }
    const routeStations = await this.system.routeStation.findMany({
      where: {
        stationId: { in: wanted },
        route: {
          trips: { some: { fleetId, status: { in: ['SCHEDULED', 'DEPARTED'] } } },
        },
      },
      select: { routeId: true, stationId: true, stopOrder: true, stopType: true },
    });
    if (boardingStationId && landingStationId) {
      // Same-station favorites are not meaningful (mirrors the booking rule:
      // a converted pair would otherwise satisfy the order check for X→X).
      if (boardingStationId === landingStationId) {
        throw new CodedException(
          422,
          'INVALID_FAVORITE_STOPS',
          'Boarding and landing stops must be different stations.',
        );
      }
      const byRoute = new Map<string, typeof routeStations>();
      for (const rs of routeStations) {
        const list = byRoute.get(rs.routeId) ?? [];
        list.push(rs);
        byRoute.set(rs.routeId, list);
      }
      const valid = [...byRoute.values()].some((stops) => {
        // Capability-aware (same converted-pair rule as booking validation).
        const boarding = stops.find(
          (s) => s.stationId === boardingStationId && ['BOARDING', 'BOTH'].includes(s.stopType),
        );
        const landing = stops.find(
          (s) => s.stationId === landingStationId && ['LANDING', 'BOTH'].includes(s.stopType),
        );
        return (
          boarding &&
          landing &&
          boarding.stopOrder < landing.stopOrder
        );
      });
      if (!valid) {
        throw new CodedException(
          422,
          'INVALID_FAVORITE_STOPS',
          'Boarding must come before landing on a route this fleet serves.',
        );
      }
      return;
    }
    const singleId = (boardingStationId ?? landingStationId)!;
    // Single-preference validation is capability-aware too: a boarding-only
    // preference needs a BOARDING|BOTH row, a landing-only preference a
    // LANDING|BOTH row (a LANDING-only station is not a valid boarding stop).
    const singleAllowed = boardingStationId ? ['BOARDING', 'BOTH'] : ['LANDING', 'BOTH'];
    if (!routeStations.some((rs) => rs.stationId === singleId && singleAllowed.includes(rs.stopType))) {
      throw new CodedException(
        422,
        'INVALID_FAVORITE_STOPS',
        'Chosen stop is not served by this fleet.',
      );
    }
  }

  private async presentOne(row: Favorite): Promise<FavoriteItem> {
    const [item] = await this.presentMany([row]);
    return item;
  }

  private async presentMany(rows: Favorite[]): Promise<FavoriteItem[]> {
    const fleetIds = [...new Set(rows.map((r) => r.fleetId).filter(Boolean))] as string[];
    const busIds = [...new Set(rows.map((r) => r.busId).filter(Boolean))] as string[];
    const stationIds = [
      ...new Set(
        rows.flatMap((r) => [r.boardingStationId, r.landingStationId]).filter(Boolean),
      ),
    ] as string[];
    const [fleets, buses, stations] = await Promise.all([
      fleetIds.length
        ? this.system.fleet.findMany({
            where: { id: { in: fleetIds } },
            select: { id: true, name: true, isActive: true },
          })
        : Promise.resolve([]),
      busIds.length
        ? this.system.bus.findMany({
            where: { id: { in: busIds } },
            select: {
              id: true,
              fleetId: true,
              registrationNumber: true,
              plateNumber: true,
              isActive: true,
              fleet: { select: { id: true, name: true, isActive: true } },
            },
          })
        : Promise.resolve([]),
      stationIds.length
        ? this.system.station.findMany({
            where: { id: { in: stationIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    const fleetMap = new Map(fleets.map((f) => [f.id, f]));
    const busMap = new Map(buses.map((b) => [b.id, b]));
    const stationMap = new Map(stations.map((s) => [s.id, s]));
    return rows.map((row) => {
      const fleet = row.fleetId ? (fleetMap.get(row.fleetId) ?? null) : null;
      const bus = row.busId ? (busMap.get(row.busId) ?? null) : null;
      const targetActive =
        row.type === 'FLEET'
          ? (fleet?.isActive ?? false)
          : (bus?.isActive ?? false) && (bus?.fleet.isActive ?? false);
      return {
        id: row.id,
        type: row.type,
        fleetId: row.fleetId,
        busId: row.busId,
        boardingStationId: row.boardingStationId,
        landingStationId: row.landingStationId,
        createdAt: row.createdAt,
        fleet,
        bus: bus
          ? {
              id: bus.id,
              fleetId: bus.fleetId,
              registrationNumber: bus.registrationNumber,
              plateNumber: bus.plateNumber,
              isActive: bus.isActive,
              fleetName: bus.fleet.name,
              fleetActive: bus.fleet.isActive,
            }
          : null,
        boardingStation: row.boardingStationId
          ? (stationMap.get(row.boardingStationId) ?? null)
          : null,
        landingStation: row.landingStationId
          ? (stationMap.get(row.landingStationId) ?? null)
          : null,
        isTargetActive: targetActive,
      };
    });
  }
}
