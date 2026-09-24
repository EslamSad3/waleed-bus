import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Architectural Boundary Test: SystemPrismaService Allowlist
 *
 * `SystemPrismaService` operates as the privileged table owner without PostgreSQL RLS.
 * To prevent security boundary degradation, only files with documented, verified
 * justification in `docs/SYSTEM_PRISMA_JUSTIFICATIONS.md` are permitted to import it.
 *
 * Any new usage MUST be vetted and explicitly added to this allowlist and the justification document.
 */
describe('SystemPrisma Architectural Boundary', () => {
  const APPROVED_SYSTEM_PRISMA_FILES = new Set([
    // Core Infrastructure
    'audit/audit.service.ts',
    'auth/auth.service.ts',
    'authorization/services/fleet-path.service.ts',
    'prisma/prisma.module.ts',

    // Super-Admin Cross-Fleet Booking Management
    'bookings/admin-booking-lifecycle.service.ts',
    'bookings/admin-bookings-query.service.ts',
    'bookings/admin-payment.service.ts',
    'bookings/admin-report.service.ts',

    // Public / Passenger Self-Service
    'bookings/passenger-booking.service.ts',
    'bookings/passenger-rating.service.ts',
    'bookings/trip-shares.service.ts',

    // Operations / Bootstrap
    'driver-ops/driver-ops.service.ts',
    'fleet-owner/driver-assignment.service.ts',
    'fleet-owner/driver-roster.service.ts',
    'fleets/fleets.service.ts',
    'fleets/members.service.ts',
    'passenger-auth/otp.service.ts',
    'passenger-auth/passenger.service.ts',
    'passenger-auth/throttle.service.ts',
    'permissions/permissions.service.ts',
    'roles/roles.service.ts',
    'buses/vehicle-brand.service.ts',
    'routes/routes.service.ts',
    'trips/trips.service.ts',
    'users/users.service.ts',

    // Global Commercial Catalog (lines/routes/stations are platform-wide, not fleet-scoped)
    'favorites/favorites.service.ts',
    'fleet-owner/bus-trip-line.service.ts',
    'fleet-owner/fleet-owners-admin.service.ts',
    'fleet-owner/discovery.service.ts',
    'fleet-owner/vip-tier.service.ts',
    'notifications/notifications.service.ts',
    'notifications/platform-notifications.controller.ts',
    'promotions/promotions.service.ts',
    'promotions/platform-promotions.controller.ts',
    'routes/geography.service.ts',
    'routes/trip-lines.service.ts',
  ]);

  function collectTsFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectTsFiles(fullPath));
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.spec.ts') &&
        !entry.name.endsWith('.d.ts')
      ) {
        files.push(fullPath);
      }
    }
    return files;
  }

  it('ensures only approved files import SystemPrismaService', () => {
    const srcDir = path.resolve(__dirname, '..');
    const allTsFiles = collectTsFiles(srcDir);

    const violatingFiles: string[] = [];

    for (const filePath of allTsFiles) {
      const relativePath = path
        .relative(srcDir, filePath)
        .replace(/\\/g, '/');

      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.includes('SystemPrismaService')) {
        if (!APPROVED_SYSTEM_PRISMA_FILES.has(relativePath)) {
          violatingFiles.push(relativePath);
        }
      }
    }

    expect(
      violatingFiles,
      `The following files import SystemPrismaService without authorization:\n` +
        `${violatingFiles.join('\n')}\n\n` +
        `Refer to docs/SYSTEM_PRISMA_JUSTIFICATIONS.md before adding any new system path usage.`,
    ).toEqual([]);
  });
});
