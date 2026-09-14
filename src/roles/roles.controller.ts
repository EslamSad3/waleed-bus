import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import {
  Platform,
  RequirePermission,
} from '../authorization/decorators/permissions.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  ApiAuthErrors,
  ApiConflict,
  ApiCursorPagination,
  ApiEnvelopeResponse,
  ApiNotFound,
  ApiUuidParam,
} from '../openapi/api-helpers.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import { RolesService } from './roles.service.js';
import {
  CreateRoleDto,
  RoleDto,
  SetRolePermissionsDto,
  UpdateRoleDto,
} from './dto/role.dto.js';

/**
 * Platform role administration — privileged path (system database client),
 * super admin only, audited.
 */
@ApiTags('roles')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Platform()
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @RequirePermission('roles.create')
  @ApiOperation({
    summary:
      'Create a role (kebab-case slug, optional initial permission keys).',
  })
  @ApiEnvelopeResponse(201, 'Role created.', RoleDto)
  @ApiConflict(
    'Role slug already exists, or an initial permission key is unknown.',
  )
  create(@Body() dto: CreateRoleDto, @CurrentUser() actor: RequestUser) {
    return this.rolesService.create(dto, actor.id);
  }

  @Get()
  @RequirePermission('roles.read')
  @ApiOperation({ summary: 'List roles (cursor pagination).' })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(
    200,
    'Cursor page of roles (items + nextCursor).',
    RoleDto,
    true,
  )
  findAll(@Query() query: { cursor?: string; limit?: string }) {
    return this.rolesService.findAll(query);
  }

  @Get(':id')
  @RequirePermission('roles.read')
  @ApiOperation({ summary: 'Fetch one role by id.' })
  @ApiUuidParam('id', 'Role id (uuid).')
  @ApiEnvelopeResponse(200, 'The role.', RoleDto)
  @ApiNotFound('Role not found.')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.rolesService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('roles.update')
  @ApiOperation({ summary: 'Update role name/description/active flag.' })
  @ApiUuidParam('id', 'Role id (uuid).')
  @ApiEnvelopeResponse(200, 'Updated role.', RoleDto)
  @ApiNotFound('Role not found.')
  @ApiConflict('New slug already exists.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.rolesService.update(id, dto, actor.id);
  }

  @Delete(':id')
  @RequirePermission('roles.delete')
  @ApiOperation({ summary: 'Delete a non-system role.' })
  @ApiUuidParam('id', 'Role id (uuid).')
  @ApiEnvelopeResponse(200, 'Role deleted; data is null.')
  @ApiNotFound('Role not found.')
  @ApiConflict('System roles cannot be deleted.')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.rolesService.remove(id, actor.id);
  }

  @Put(':id/permissions')
  @RequirePermission('roles.update')
  @ApiOperation({ summary: 'Atomically replace the role permission set.' })
  @ApiUuidParam('id', 'Role id (uuid).')
  @ApiEnvelopeResponse(200, 'Role with its replaced permission set.', RoleDto)
  @ApiNotFound('Role not found.')
  @ApiConflict(
    'System role permissions cannot be modified, or a key is unknown.',
  )
  setPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRolePermissionsDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.rolesService.setPermissions(id, dto.permissionKeys, actor.id);
  }
}
