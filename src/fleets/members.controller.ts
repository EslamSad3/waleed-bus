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
  RequireAnyPermission,
  RequirePermission,
} from '../authorization/decorators/permissions.decorator.js';
import { CurrentFleet } from '../common/decorators/current-fleet.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  ApiAuthErrors,
  ApiConflict,
  ApiCursorPagination,
  ApiEnvelopeResponse,
  ApiFleetIdParam,
  ApiNotFound,
  ApiUuidParam,
} from '../openapi/api-helpers.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import type { FleetContext } from '../authorization/services/authorization.service.js';
import { MembersService } from './members.service.js';
import {
  AddMemberDto,
  FleetMemberDto,
  UpdateMemberDto,
} from '../users/dto/user.dto.js';

/**
 * Fleet membership management — fleet-scoped routes. `members.manage` for
 * fleet members, or the verified super_admin via the platform path.
 */
@ApiTags('fleet-members')
@ApiSecurity('bearer')
@ApiAuthErrors()
@ApiFleetIdParam()
@Controller('fleets/:fleetId/members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Post()
  @RequirePermission('members.manage')
  @ApiOperation({
    summary: 'Add a user to the fleet with a role (members.manage required).',
  })
  @ApiEnvelopeResponse(
    201,
    'Membership created (defaults to ACTIVE).',
    FleetMemberDto,
  )
  @ApiNotFound('Target user or role not found/inactive (404).')
  @ApiConflict('The user is already a member of this fleet.')
  add(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('fleetId', ParseUUIDPipe) _fleetId: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.membersService.add(actor, fleetContext, dto);
  }

  @Get()
  @RequireAnyPermission('members.read', 'members.manage')
  @ApiOperation({ summary: 'List the fleet memberships (cursor pagination).' })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(
    200,
    'Cursor page of memberships (items + nextCursor).',
    FleetMemberDto,
    true,
  )
  list(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('fleetId', ParseUUIDPipe) _fleetId: string,
    @Query() query: { cursor?: string; limit?: string },
  ) {
    return this.membersService.list(actor, fleetContext, query);
  }

  @Patch(':memberId')
  @RequirePermission('members.manage')
  @ApiOperation({
    summary:
      'Change a member role/status (suspension revokes sessions immediately).',
  })
  @ApiUuidParam('memberId', 'Membership id (uuid).')
  @ApiEnvelopeResponse(200, 'Updated membership.', FleetMemberDto)
  @ApiNotFound(
    'Membership not found in this fleet (cross-fleet ids are also 404).',
  )
  @ApiConflict('Role slug unknown/inactive for the resolution strategy.')
  update(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('fleetId', ParseUUIDPipe) _fleetId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.membersService.update(actor, fleetContext, memberId, dto);
  }

  @Delete(':memberId')
  @RequirePermission('members.manage')
  @ApiOperation({
    summary: 'Remove a membership (target sessions invalidated immediately).',
  })
  @ApiUuidParam('memberId', 'Membership id (uuid).')
  @ApiEnvelopeResponse(200, 'Membership removed; data is null.')
  @ApiNotFound(
    'Membership not found in this fleet (cross-fleet ids are also 404).',
  )
  remove(
    @CurrentUser() actor: RequestUser,
    @CurrentFleet() fleetContext: FleetContext,
    @Param('fleetId', ParseUUIDPipe) _fleetId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.membersService.remove(actor, fleetContext, memberId);
  }
}
