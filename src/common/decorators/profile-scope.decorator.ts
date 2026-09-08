import { SetMetadata } from '@nestjs/common';

export const ALLOW_RESTRICTED_KEY = 'allowRestricted';

/**
 * Marks a route as callable with a restricted (incomplete-profile) session:
 * profile-status, profile update, and OTP steps. Every other authenticated
 * route requires a full session (verified phone).
 */
export const AllowRestricted = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_RESTRICTED_KEY, true);
