import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/** API contract version (independent of the npm package version). */
export const API_VERSION = '1.0.0';

/**
 * Single source of truth for the OpenAPI document — served at /docs by
 * main.ts and checked in as docs/openapi.json via `pnpm docs:generate`.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Bus Fleet API')
    .setDescription(
      'Multi-tenant group bus transportation platform REST API.\n\n' +
        '- **Authentication is owned by this API**: HS256 JWTs carry a custom `app_role` claim; ' +
        'refresh tokens rotate on every use and are stored hashed at rest.\n' +
        '- **Every response is wrapped in a `{ statusCode, data }` envelope**; the `data` schema is ' +
        'shown inside each documented response.\n' +
        '- **Fleet isolation is enforced by PostgreSQL RLS** as the final security boundary; ' +
        'cross-tenant lookups are indistinguishable from missing rows and return 404.\n' +
        '- `fleetId` path parameters are **selectors, never proof of authorization** — access is ' +
        'verified against the caller\'s ACTIVE `FleetMember` row on every request.\n' +
        '- Roles and permissions are **database-driven** (no hardcoded enums); only `super_admin` is ' +
        'a predefined system role. Platform routes (roles, permissions, users, fleets admin, ' +
        'audit-logs) are privileged: super admin only and audited.',
    )
    .setVersion(API_VERSION)
    .addBearerAuth()
    .addTag('auth', 'Login, rotating refresh tokens, logout, and the verified session identity.')
    .addTag('health', 'Liveness probe and service information.')
    .addTag('roles', 'Platform role administration — privileged path, super admin only, audited.')
    .addTag('permissions', 'Platform permission catalog administration — privileged path, audited.')
    .addTag('users', 'Platform user administration — privileged path, audited.')
    .addTag('fleets', 'Fleet administration (privileged) plus the caller\'s own memberships via `mine`.')
    .addTag('fleet-members', 'Fleet membership management within a tenant fleet (tenant path).')
    .addTag('buses', 'Fleet-owned bus CRUD — tenant path, RLS-enforced.')
    .addTag('trips', 'Fleet-owned trip CRUD — tenant path, RLS-enforced.')
    .addTag('bookings', 'Fleet-owned booking CRUD — tenant path, RLS-enforced.')
    .addTag('audit', 'Platform audit log reads — privileged path, super admin only.')
    .addTag('passenger-auth', 'Mobile passenger registration, OTP phone verification, and profile completion.')
    .addTag('passenger-trips', 'Passenger trip search, station itineraries, and real-time seat inventory.')
    .addTag('passenger-bookings', 'Passenger seat reservation, booking history, cancellation, and active trip tracking.')
    .addTag('routes', 'Public QR route resolution and station itineraries.')
    .addTag('public-shares', 'Public read-only live tracking share verification.')
    .build();
  return SwaggerModule.createDocument(app, config);
}
