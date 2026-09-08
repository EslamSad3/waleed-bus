import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { AllowRestricted } from '../common/decorators/profile-scope.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CodedException } from '../common/filters/coded.exception.js';
import { ApiAuthErrors, ApiEnvelopeResponse } from '../openapi/api-helpers.js';
import type { RequestUser } from '../auth/jwt-payload.js';
import {
  ProfileStatusDto,
  RegisterDto,
  SendOtpDto,
  UpdateMeDto,
  VerifyOtpDto,
} from './dto/passenger-auth.dto.js';
import { OtpService } from './otp.service.js';
import { PassengerService } from './passenger.service.js';
import { normalizePhone } from './phone.util.js';
import { ThrottleService } from './throttle.service.js';

/** Locked budgets (spec clarification 2026-09-07). */
const SEND_BUDGET = { limit: 3, windowMs: 10 * 60_000 };
const VERIFY_BUDGET = { limit: 10, windowMs: 10 * 60_000 };

/**
 * Passenger auth routes (spec 002, PRD #4/#5 passenger slices).
 * OTP routes are public (unauthenticated verification flow); profile routes
 * admit restricted sessions via @AllowRestricted().
 */
@ApiTags('passenger-auth')
@Controller()
export class PassengerAuthController {
  constructor(
    private readonly passengers: PassengerService,
    private readonly otp: OtpService,
    private readonly throttle: ThrottleService,
  ) {}

  private async checkBudget(
    key: string,
    budget: { limit: number; windowMs: number },
    scope: string,
  ): Promise<void> {
    const verdict = await this.throttle.hit(key, budget);
    if (!verdict.allowed) {
      throw new CodedException(
        429,
        'OTP_RATE_LIMITED',
        'Too many attempts. Try again later.',
        { scope },
        verdict.retryAfterSeconds,
      );
    }
  }

  @Public()
  @Post('auth/register')
  @ApiOperation({ summary: 'Register a passenger with name + phone + password (pending verification).' })
  @ApiEnvelopeResponse(201, 'Pending passenger; verification challenge opened for the phone.')
  @ApiResponse({ status: 422, description: 'Invalid payload.' })
  @ApiResponse({ status: 429, description: 'Send throttle exceeded (retryAfter seconds).' })
  register(@Body() dto: RegisterDto) {
    return this.passengers.register(dto);
  }

  @Public()
  @Post('auth/phone/send-otp')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Open or refresh the OTP challenge for a phone.' })
  @ApiEnvelopeResponse(201, 'Challenge active; expiresInSeconds until expiry.')
  @ApiResponse({ status: 422, description: 'Invalid phone.' })
  @ApiResponse({ status: 429, description: 'Resend cooldown or send throttle (retryAfter seconds).' })
  async sendOtp(@Body() dto: SendOtpDto) {
    const phoneNumber = normalizePhone(dto.phoneNumber);
    await this.checkBudget(`otp:send:${phoneNumber}`, SEND_BUDGET, 'send');
    const { expiresInSeconds } = await this.otp.openChallenge(phoneNumber, 'PROFILE', null);
    return { sent: true, expiresInSeconds };
  }

  @Public()
  @Post('auth/phone/verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify the OTP and mark the phone verified (single use).' })
  @ApiEnvelopeResponse(200, 'Phone verified.', ProfileStatusDto)
  @ApiResponse({ status: 404, description: 'Invalid code (uniform, no oracle).' })
  @ApiResponse({ status: 410, description: 'Expired challenge; request a new code.' })
  @ApiResponse({ status: 429, description: 'Verify throttle exceeded (retryAfter seconds).' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    const phoneNumber = normalizePhone(dto.phoneNumber);
    // Throttle is the outer gate (one active challenge per phone, so a
    // phone-keyed budget equals the specified per-challenge budget).
    await this.checkBudget(`otp:verify:${phoneNumber}`, VERIFY_BUDGET, 'verify');
    await this.otp.verifyChallenge(phoneNumber, dto.otp);
    return { success: true, phoneVerified: true };
  }

  @AllowRestricted()
  @Get('me/profile-status')
  @ApiSecurity('bearer')
  @ApiAuthErrors()
  @ApiOperation({ summary: 'Report profile completeness and phone verification state.' })
  @ApiEnvelopeResponse(200, 'Completeness status with missing fields.', ProfileStatusDto)
  profileStatus(@CurrentUser() user: RequestUser) {
    return this.passengers.getProfileStatus(user.id);
  }

  @AllowRestricted()
  @Patch('me')
  @ApiSecurity('bearer')
  @ApiAuthErrors()
  @ApiOperation({ summary: 'Update name, phone, or picture. A new phone resets verification.' })
  @ApiEnvelopeResponse(200, 'Updated profile with verification state.')
  @ApiResponse({ status: 400, description: 'Invalid payload or empty update.' })
  @ApiResponse({ status: 409, description: 'Phone unavailable (non-revealing).' })
  updateMe(@CurrentUser() user: RequestUser, @Body() dto: UpdateMeDto) {
    return this.passengers.updateProfile(user.id, dto);
  }
}
