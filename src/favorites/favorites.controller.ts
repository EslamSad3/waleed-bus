import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { RequestUser } from '../auth/jwt-payload.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  ApiAuthErrors,
  ApiCursorPagination,
  ApiEnvelopeResponse,
  ApiNotFound,
  ApiUuidParam,
} from '../openapi/api-helpers.js';
import {
  CreateFavoriteDto,
  FavoriteDto,
  UpdateFavoriteDto,
} from './dto/favorite.dto.js';
import { FavoritesService } from './favorites.service.js';

@ApiTags('passenger-favorites')
@ApiSecurity('bearer')
@ApiAuthErrors()
@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Post()
  @ApiOperation({ summary: 'Favorite a fleet or a bus, with optional stop prefs.' })
  @ApiEnvelopeResponse(201, 'Favorite created.', FavoriteDto)
  create(@CurrentUser() actor: RequestUser, @Body() dto: CreateFavoriteDto) {
    return this.favorites.createFavorite(actor, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List my favorites with target-activity flags.' })
  @ApiCursorPagination()
  @ApiEnvelopeResponse(200, 'My favorites.', FavoriteDto, true)
  list(
    @CurrentUser() actor: RequestUser,
    @Query() query: { cursor?: string; limit?: string },
  ) {
    return this.favorites.listFavorites(actor, query);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update my favorite stop prefs.' })
  @ApiUuidParam('id', 'Favorite id.')
  @ApiEnvelopeResponse(200, 'Favorite updated.', FavoriteDto)
  @ApiNotFound('Favorite not found.')
  update(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFavoriteDto,
  ) {
    return this.favorites.updateFavorite(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete my favorite.' })
  @ApiUuidParam('id', 'Favorite id.')
  @ApiEnvelopeResponse(200, 'Favorite deleted.')
  @ApiNotFound('Favorite not found.')
  async remove(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.favorites.deleteFavorite(actor, id);
    return null;
  }
}
