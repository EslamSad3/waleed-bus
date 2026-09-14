import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { PermissionsService } from './permissions.service.js';
import {
  CreatePermissionDto,
  PermissionDto,
  UpdatePermissionDto,
} from './dto/permission.dto.js';

@ApiTags('permissions')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Platform()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Post()
  @RequirePermission('permissions.create')
  @ApiOperation({ summary: 'Create a permission (resource.action key).' })
  @ApiEnvelopeResponse(201, 'Permission created.', PermissionDto)
  @ApiConflict('Permission key already exists.')
  create(@Body() dto: CreatePermissionDto, @CurrentUser() actor: RequestUser) {
    return this.permissionsService.create(dto, actor.id);
  }

  @Get()
  @RequirePermission('permissions.read')
  @ApiOperation({ summary: 'List the permission catalog (cursor pagination).' })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(
    200,
    'Cursor page of permissions (items + nextCursor).',
    PermissionDto,
    true,
  )
  findAll(@Query() query: { cursor?: string; limit?: string }) {
    return this.permissionsService.findAll(query);
  }

  @Get(':id')
  @RequirePermission('permissions.read')
  @ApiOperation({ summary: 'Fetch one permission by id.' })
  @ApiUuidParam('id', 'Permission id (uuid).')
  @ApiEnvelopeResponse(200, 'The permission.', PermissionDto)
  @ApiNotFound('Permission not found.')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.permissionsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('permissions.update')
  @ApiOperation({ summary: 'Update permission description/active flag.' })
  @ApiUuidParam('id', 'Permission id (uuid).')
  @ApiEnvelopeResponse(200, 'Updated permission.', PermissionDto)
  @ApiNotFound('Permission not found.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePermissionDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.permissionsService.update(id, dto, actor.id);
  }

  @Delete(':id')
  @RequirePermission('permissions.delete')
  @ApiOperation({ summary: 'Delete a permission.' })
  @ApiUuidParam('id', 'Permission id (uuid).')
  @ApiEnvelopeResponse(200, 'Permission deleted; data is null.')
  @ApiNotFound('Permission not found.')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.permissionsService.remove(id, actor.id);
  }
}
