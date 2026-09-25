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
import { UsersService } from './users.service.js';
import {
  CreateUserDto,
  SetUserRolesDto,
  TargetOptionDto,
  UpdateUserDto,
  UserDto,
} from './dto/user.dto.js';

@ApiTags('users')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Platform()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @RequirePermission('users.create')
  @ApiOperation({
    summary: 'Create a platform user (optionally with global role slugs).',
  })
  @ApiEnvelopeResponse(
    201,
    'User created. Password hashes are never returned.',
    UserDto,
  )
  @ApiConflict(
    'Email already exists, or a global role slug is unknown/inactive.',
  )
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: RequestUser) {
    return this.usersService.create(dto, actor.id);
  }

  @Get()
  @RequirePermission('users.read')
  @ApiOperation({ summary: 'List platform users (cursor pagination).' })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(
    200,
    'Cursor page of users (items + nextCursor).',
    UserDto,
    true,
  )
  findAll(@Query() query: { cursor?: string; limit?: string }) {
    return this.usersService.findAll(query);
  }

  @Get('target-options')
  @RequirePermission('users.read')
  @ApiOperation({
    summary:
      'Search eligible promotion targets (active passenger accounts, server-side).',
  })
  @ApiEnvelopeResponse(
    200,
    'Up to `limit` (default 20, max 50) matching users: id/name/email/phoneNumber.',
    TargetOptionDto,
    true,
  )
  findTargetOptions(@Query() query: { q?: string; limit?: string }) {
    return this.usersService.findTargetOptions(query);
  }

  @Get(':id')
  @RequirePermission('users.read')
  @ApiOperation({ summary: 'Fetch one user by id.' })
  @ApiUuidParam('id', 'User id (uuid).')
  @ApiEnvelopeResponse(200, 'The user.', UserDto)
  @ApiNotFound('User not found.')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('users.update')
  @ApiOperation({
    summary:
      'Update user name/active flag/password (deactivation revokes sessions).',
  })
  @ApiUuidParam('id', 'User id (uuid).')
  @ApiEnvelopeResponse(200, 'Updated user.', UserDto)
  @ApiNotFound('User not found.')
  @ApiConflict('Cannot deactivate the last active super admin (409).')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.usersService.update(id, dto, actor.id);
  }

  @Put(':id/roles')
  @RequirePermission('users.update')
  @ApiOperation({
    summary:
      'Replace the user global role set (bumps authVersion, revokes sessions).',
  })
  @ApiUuidParam('id', 'User id (uuid).')
  @ApiEnvelopeResponse(
    200,
    'Updated user; outstanding tokens are invalidated.',
    UserDto,
  )
  @ApiNotFound('User not found.')
  @ApiConflict(
    'Cannot remove the last active super admin, or a slug is unknown/inactive.',
  )
  setRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserRolesDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.usersService.setGlobalRoles(id, dto.roleSlugs, actor.id);
  }

  @Delete(':id')
  @RequirePermission('users.delete')
  @ApiOperation({ summary: 'Delete a user (self-lockout protected).' })
  @ApiUuidParam('id', 'User id (uuid).')
  @ApiEnvelopeResponse(200, 'User deleted; data is null.')
  @ApiNotFound('User not found.')
  @ApiConflict('Cannot delete the last active super admin.')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.usersService.remove(id, actor.id);
  }
}
