import { Type, applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiHeader, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { getSchemaPath } from '@nestjs/swagger';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../common/pagination.js';

/**
 * Success response documented in the API's actual wire shape: the
 * `{ statusCode, data }` envelope with `data` referencing the entity schema.
 * `ApiExtraModels` guarantees the referenced schema lands in components.
 */
export function ApiEnvelopeResponse(
  status: number,
  description: string,
  type?: Type<unknown>,
  isArray = false,
): MethodDecorator & ClassDecorator {
  const data = type
    ? isArray
      ? { type: 'array' as const, items: { $ref: getSchemaPath(type) } }
      : { $ref: getSchemaPath(type) }
    : { nullable: true, example: null };
  const extraModels = type ? ApiExtraModels(type) : (): void => {};
  return applyDecorators(
    extraModels,
    ApiResponse({
      status,
      description,
      schema: {
        type: 'object',
        properties: { statusCode: { type: 'integer', example: status }, data },
        required: ['statusCode', 'data'],
      },
    }),
  );
}

/** Cursor pagination query parameters shared by every collection endpoint. */
export function ApiCursorPagination(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiQuery({
      name: 'cursor',
      required: false,
      description: 'Opaque nextCursor from the previous page (base64url of the last item id).',
      schema: { type: 'string' },
    }),
    ApiQuery({
      name: 'limit',
      required: false,
      description: `Page size (default ${DEFAULT_PAGE_SIZE}, max ${MAX_PAGE_SIZE}).`,
      schema: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE },
    }),
  );
}

/**
 * The fleet selector path parameter. Present on every tenant-scoped route; it
 * selects the fleet but never proves authorization on its own.
 */
export function ApiFleetIdParam(): MethodDecorator & ClassDecorator {
  return ApiParam({
    name: 'fleetId',
    required: true,
    description: 'Fleet selector (uuid) — a selector only; membership is verified server-side.',
    schema: { type: 'string', format: 'uuid' },
  });
}

/** Documented uuid path parameter for resource ids. */
export function ApiUuidParam(name: string, description: string): MethodDecorator {
  return ApiParam({ name, required: true, description, schema: { type: 'string', format: 'uuid' } });
}

/**
 * The fleet selector header. Used by routes without a `:fleetId` path
 * parameter (owner/driver mobile surfaces); it selects the fleet but never
 * proves authorization on its own — TenantContextGuard verifies membership.
 */
export function ApiFleetIdHeader(): MethodDecorator & ClassDecorator {
  return ApiHeader({
    name: 'x-fleet-id',
    required: true,
    description: 'Fleet selector (uuid) — a selector only; membership is verified server-side.',
    schema: { type: 'string', format: 'uuid' },
  });
}

/** Standard error responses for authenticated endpoints. */
export function ApiAuthErrors(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiResponse({
      status: 401,
      description:
        'Missing/invalid/expired token, revoked session, stale authVersion, or deactivated account.',
    }),
    ApiResponse({
      status: 403,
      description: 'Authenticated but lacking the required permission (or no ACTIVE membership).',
    }),
  );
}

/** Resource misses — including cross-tenant lookups — surface as 404. */
export function ApiNotFound(description: string): MethodDecorator & ClassDecorator {
  return ApiResponse({ status: 404, description });
}

/** Uniqueness violations map to 409. */
export function ApiConflict(description: string): MethodDecorator & ClassDecorator {
  return ApiResponse({ status: 409, description });
}
