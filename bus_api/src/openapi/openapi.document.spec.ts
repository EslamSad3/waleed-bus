import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpenAPIObject } from '@nestjs/swagger';
import { API_VERSION, buildOpenApiDocument } from './openapi.document.js';

/**
 * Contract tests for the generated OpenAPI document. The document is the
 * single source of truth served at /docs and checked in as docs/openapi.json.
 */
describe('OpenAPI document', () => {
  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    // Placeholders only — no database connection is ever made; the document is
    // built from route/DTO metadata alone.
    process.env.TEST_DATABASE_URL ??= 'postgresql://app_tenant:placeholder@localhost:5432/bus_test';
    process.env.TEST_DIRECT_URL ??= 'postgresql://postgres:placeholder@localhost:5432/bus_test';
    process.env.JWT_SECRET ??= 'unit-test-secret-0123456789abcdef0123456789';
    process.env.JWT_ISSUER ??= 'bus-api';
    process.env.JWT_AUDIENCE ??= 'bus-client';
    process.env.JWT_EXPIRES_IN ??= '15m';

    const { AppModule } = await import('../app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    doc = buildOpenApiDocument(app);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  /** Flatten the document into [path, method, operation] triples. */
  function operations(): Array<[string, string, Record<string, any>]> {
    const result: Array<[string, string, Record<string, any>]> = [];
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(methods as Record<string, unknown>)) {
        if (method === 'parameters') continue;
        result.push([path, method, op as Record<string, any>]);
      }
    }
    return result;
  }

  it('carries API metadata, a bearer security scheme, and described tags', () => {
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.info.title).toBe('Bus Fleet API');
    expect(doc.info.version).toBe(API_VERSION);
    // The response envelope is part of the contract — it must be documented.
    expect(doc.info.description).toContain('{ statusCode, data }');

    expect(doc.components?.securitySchemes?.bearer).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });

    const tagNames = (doc.tags ?? []).map((t) => t.name);
      expect(tagNames).toEqual(
      expect.arrayContaining([
        'auth', 'health', 'roles', 'permissions', 'users', 'fleets',
        'fleet-members', 'buses', 'trips', 'bookings', 'audit', 'passenger-auth',
      ]),
    );
    for (const tag of doc.tags ?? []) {
      expect(tag.description, `tag ${tag.name} description`).toBeTruthy();
    }
  });

  it('documents every controller route', () => {
    const expectedPaths = [
      '/',
      '/health',
      '/auth/login',
      '/auth/refresh',
      '/auth/logout',
      '/auth/me',
      '/auth/register',
      '/auth/phone/send-otp',
      '/auth/phone/verify-otp',
      '/me/profile-status',
      '/me',
      '/roles',
      '/roles/{id}',
      '/roles/{id}/permissions',
      '/permissions',
      '/permissions/{id}',
      '/users',
      '/users/{id}',
      '/users/{id}/roles',
      '/fleets',
      '/fleets/mine',
      '/fleets/{id}',
      '/fleets/{fleetId}/members',
      '/fleets/{fleetId}/members/{memberId}',
      '/fleets/{fleetId}/buses',
      '/fleets/{fleetId}/buses/{id}',
      '/fleets/{fleetId}/trips',
      '/fleets/{fleetId}/trips/{id}',
      '/fleets/{fleetId}/bookings',
      '/fleets/{fleetId}/bookings/{id}',
      '/audit-logs',
    ];
    for (const path of expectedPaths) {
      expect(doc.paths, path).toHaveProperty(path);
    }
  });

  it('requires bearer auth everywhere except public endpoints', () => {
    const publicOperations = new Set([
      'get /',
      'post /auth/login',
      'post /auth/refresh',
      'post /auth/register',
      'post /auth/phone/send-otp',
      'post /auth/phone/verify-otp',
      'get /health',
    ]);
    for (const [path, method, op] of operations()) {
      const key = `${method} ${path}`;
      if (publicOperations.has(key)) {
        expect(op.security ?? [], `${key} must be public`).toEqual([]);
      } else {
        expect(op.security, `${key} must require bearer auth`).toEqual([{ bearer: [] }]);
      }
    }
  });

  it('gives every operation a summary, a tag, and a documented success response', () => {
    for (const [path, method, op] of operations()) {
      const key = `${method} ${path}`;
      expect(op.summary, `${key} summary`).toBeTruthy();
      expect(op.tags?.length, `${key} tags`).toBeGreaterThan(0);
      const success = op.responses?.['200'] ?? op.responses?.['201'] ?? op.responses?.['204'];
      expect(success, `${key} success response`).toBeTruthy();
    }
  });

  it('documents cursor pagination query parameters on collection endpoints', () => {
    const collections = [
      '/roles', '/permissions', '/users', '/fleets', '/audit-logs',
      '/fleets/{fleetId}/members', '/fleets/{fleetId}/buses',
      '/fleets/{fleetId}/trips', '/fleets/{fleetId}/bookings',
    ];
    for (const path of collections) {
      const parameters = (doc.paths[path]?.get?.parameters ?? []) as Array<Record<string, any>>;
      const names = parameters.map((p) => p.name);
      expect(names, `${path} cursor/limit`).toEqual(expect.arrayContaining(['cursor', 'limit']));
      const limit = parameters.find((p) => p.name === 'limit');
      expect(limit?.schema, `${path} limit constraints`).toMatchObject({
        type: 'integer',
        minimum: 1,
        maximum: 100,
        default: 20,
      });
    }
  });

  it('documents uuid path parameters', () => {
    const busesList = (doc.paths['/fleets/{fleetId}/buses'].get?.parameters ?? []) as Array<Record<string, any>>;
    expect(busesList.find((p) => p.name === 'fleetId')).toMatchObject({
      in: 'path',
      required: true,
      schema: { format: 'uuid' },
    });
    const busOne = (doc.paths['/fleets/{fleetId}/buses/{id}'].get?.parameters ?? []) as Array<Record<string, any>>;
    expect(busOne.find((p) => p.name === 'id')).toMatchObject({
      in: 'path',
      required: true,
      schema: { format: 'uuid' },
    });
    const memberUpdate = (doc.paths['/fleets/{fleetId}/members/{memberId}'].patch?.parameters ??
      []) as Array<Record<string, any>>;
    expect(memberUpdate.find((p) => p.name === 'memberId')).toMatchObject({
      in: 'path',
      required: true,
      schema: { format: 'uuid' },
    });
  });

  it('documents request DTO schemas with constraints, optional fields, and enums', () => {
    const schemas = (doc.components?.schemas ?? {}) as Record<string, any>;

    const createBus = schemas.CreateBusDto;
    expect(createBus.properties.registrationNumber).toMatchObject({ minLength: 1, maxLength: 50 });
    expect(createBus.required).toEqual(expect.arrayContaining(['registrationNumber', 'capacity']));

    const updateBus = schemas.UpdateBusDto;
    expect(Object.keys(updateBus.properties)).toEqual(
      expect.arrayContaining(['plateNumber', 'capacity', 'isActive']),
    );

    const createUser = schemas.CreateUserDto;
    expect(createUser.properties.email).toMatchObject({ format: 'email' });
    expect(createUser.properties.password).toMatchObject({ minLength: 8, maxLength: 128 });
    expect(Object.keys(createUser.properties)).toEqual(
      expect.arrayContaining(['name', 'globalRoleSlugs']),
    );

    const updateUser = schemas.UpdateUserDto;
    expect(Object.keys(updateUser.properties)).toEqual(
      expect.arrayContaining(['name', 'isActive', 'password']),
    );

    const createRole = schemas.CreateRoleDto;
    expect(createRole.properties.slug).toMatchObject({ pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' });
    expect(Object.keys(createRole.properties)).toEqual(
      expect.arrayContaining(['description', 'permissionKeys']),
    );

    const createTrip = schemas.CreateTripDto;
    expect(createTrip.properties.departAt).toMatchObject({ format: 'date-time' });
    expect(createTrip.properties.status?.enum).toEqual([
      'SCHEDULED', 'DEPARTED', 'COMPLETED', 'CANCELLED',
    ]);
    expect(Object.keys(schemas.UpdateTripDto.properties)).toEqual(
      expect.arrayContaining(['origin', 'destination', 'departAt', 'status']),
    );

    const createBooking = schemas.CreateBookingDto;
    expect(Object.keys(createBooking.properties)).toEqual(
      expect.arrayContaining(['tripId', 'passengerName', 'passengerPhone', 'status']),
    );
    expect(createBooking.properties.status?.enum).toEqual(['CONFIRMED', 'CANCELLED']);

    const addMember = schemas.AddMemberDto;
    expect(addMember.properties.userId).toMatchObject({ format: 'uuid' });
    expect(Object.keys(addMember.properties)).toEqual(
      expect.arrayContaining(['userId', 'roleSlug', 'roleId', 'status']),
    );
    expect(addMember.properties.status?.enum).toEqual(['ACTIVE', 'SUSPENDED', 'REVOKED']);
    expect(Object.keys(schemas.UpdateMemberDto.properties)).toEqual(
      expect.arrayContaining(['roleSlug', 'status']),
    );

    const createFleet = schemas.CreateFleetDto;
    expect(createFleet.properties.ownerId).toMatchObject({ format: 'uuid' });
    expect(Object.keys(schemas.UpdateFleetDto.properties)).toEqual(
      expect.arrayContaining(['name', 'isActive']),
    );

    expect(Object.keys(schemas.UpdatePermissionDto.properties)).toEqual(
      expect.arrayContaining(['description', 'isActive']),
    );
  });

  it('includes entity response schemas and never exposes password hashes', () => {
    const schemas = (doc.components?.schemas ?? {}) as Record<string, any>;
    for (const name of [
      'BusDto', 'TripDto', 'BookingDto', 'UserDto', 'RoleDto',
      'PermissionDto', 'FleetDto', 'FleetMemberDto', 'AuditLogDto',
      'LoginResponseDto', 'CurrentUserDto',
    ]) {
      expect(schemas, name).toHaveProperty(name);
    }
    expect(schemas.UserDto.properties).not.toHaveProperty('passwordHash');
    expect(schemas.UserDto.properties).toMatchObject({ email: { format: 'email' } });
    expect(schemas.BusDto.properties).toHaveProperty('registrationNumber');
    expect(schemas.TripDto.properties.status?.enum).toEqual([
      'SCHEDULED', 'DEPARTED', 'COMPLETED', 'CANCELLED',
    ]);
    expect(schemas.FleetMemberDto.properties.status?.enum).toEqual(['ACTIVE', 'SUSPENDED', 'REVOKED']);
    expect(schemas.AuditLogDto.properties).toHaveProperty('action');
  });

  it('documents the login response as a token pair with no duplicated role data', () => {
    const schemas = (doc.components?.schemas ?? {}) as Record<string, any>;
    expect(Object.keys(schemas.LoginResponseDto.properties)).toEqual(
      expect.arrayContaining(['accessToken', 'refreshToken']),
    );
    expect(schemas.LoginResponseDto.properties).not.toHaveProperty('role');
    expect(schemas.CurrentUserDto.properties).toHaveProperty('appRole');
    expect(schemas.CurrentUserDto.properties).not.toHaveProperty('role');
  });

  it('references the envelope with the entity schema on bus operations', () => {
    const created = JSON.stringify(doc.paths['/fleets/{fleetId}/buses'].post?.responses?.['201'] ?? {});
    expect(created).toContain('statusCode');
    expect(created).toContain('#/components/schemas/BusDto');

    const listed = JSON.stringify(doc.paths['/fleets/{fleetId}/buses'].get?.responses?.['200'] ?? {});
    expect(listed).toContain('#/components/schemas/BusDto');

    // Cross-tenant misses are 404s by design — the contract must say so.
    const missing = doc.paths['/fleets/{fleetId}/buses/{id}'].get?.responses?.['404'] as
      | { description?: string }
      | undefined;
    expect(missing?.description, 'bus 404 documented').toBeTruthy();
  });
});
