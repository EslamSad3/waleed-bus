import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { ApiAuthErrors, ApiEnvelopeResponse } from '../openapi/api-helpers.js';
import { CurrentUserDto, LoginRequestDto, LoginResponseDto, RefreshDto } from './dto/auth.dto.js';
import type { RequestUser } from './jwt-payload.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** Response carries tokens only — authorization claims live inside the JWT. */
  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Shared login: email platform login, PASSENGER phone / provider login, or FLEET_OWNER / DRIVER phone login.' })
  @ApiEnvelopeResponse(
    201,
    'Token pair issued. No role data is duplicated in the body — authorization claims live inside the JWT.',
    LoginResponseDto,
  )
  @ApiResponse({ status: 401, description: 'Invalid credentials (uniform response).' })
  @ApiResponse({ status: 403, description: 'Correct credentials but phone verification required (PHONE_NOT_VERIFIED).' })
  login(@Body() dto: LoginRequestDto, @Req() request: { ip?: string; headers: Record<string, string | string[] | undefined> }) {
    const context = {
      ip: request.ip,
      userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : undefined,
    };
    // Absent loginType: legacy email platform login (unchanged behavior).
    if (dto.loginType === undefined) {
      return this.authService.login({ email: dto.email as string, password: dto.password as string, ...context });
    }
    // Fleet flows (spec 003): phone+password with server-side account-type
    // verification; mismatches share the generic failure (no oracle).
    if (dto.loginType === 'FLEET_OWNER' || dto.loginType === 'DRIVER') {
      if (dto.provider !== undefined) {
        throw new CodedException(
          401,
          'AUTHENTICATION_FAILED',
          'Unable to authenticate with the provided credentials.',
        );
      }
      return this.authService.loginFleetPhone({
        loginType: dto.loginType,
        phone: dto.phone as string,
        password: dto.password as string,
        ...context,
      });
    }
    if (dto.loginType !== 'PASSENGER') {
      throw new CodedException(
        401,
        'AUTHENTICATION_FAILED',
        'Unable to authenticate with the provided credentials.',
      );
    }
    if (dto.provider !== undefined) {
      return this.authService.loginPassengerProvider({
        provider: dto.provider as 'GOOGLE' | 'APPLE',
        idToken: dto.idToken as string,
        ...context,
      });
    }
    return this.authService.loginPassengerPhone({ phone: dto.phone as string, password: dto.password as string, ...context });
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate the refresh token and mint a new access token.' })
  @ApiEnvelopeResponse(201, 'Fresh token pair; the presented refresh token is revoked.', LoginResponseDto)
  @ApiResponse({ status: 401, description: 'Unknown, expired, or already-rotated refresh token.' })
  refresh(@Body() dto: RefreshDto, @Req() request: { ip?: string; headers: Record<string, string | string[] | undefined> }) {
    return this.authService.refresh(
      dto.refreshToken,
      request.ip,
      typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : undefined,
    );
  }

  @ApiSecurity('bearer')
  @ApiAuthErrors()
  @Post('logout')
  @ApiOperation({ summary: 'Revoke the current refresh token/session.' })
  @ApiEnvelopeResponse(200, 'Session revoked; data is null.')
  logout(@CurrentUser() user: RequestUser) {
    return this.authService.logout(user.sessionId);
  }

  @ApiSecurity('bearer')
  @ApiAuthErrors()
  @Get('me')
  @ApiOperation({ summary: 'Return the verified session identity from the JWT claims.' })
  @ApiEnvelopeResponse(200, 'The authenticated identity attached to every request.', CurrentUserDto)
  me(@CurrentUser() user: RequestUser) {
    return user;
  }
}
