/** Verified JWT claims (never trust an unverified decode). */
export interface JwtPayload {
  sub: string;
  /** Null for phone-only passenger accounts (email is nullable since spec 002). */
  email: string | null;
  /** Custom application role claim — distinct from PostgreSQL's `role`. */
  app_role: string;
  authVersion: number;
  sessionId: string;
  iat?: number;
  exp?: number;
}

/** The authenticated identity attached to `request.user` after guard #1. */
export interface RequestUser {
  id: string;
  email: string | null;
  appRole: string;
  authVersion: number;
  sessionId: string;
  /**
   * Session scope derived per request from live verification state:
   * `restricted` for passenger tokens whose phone is missing/unverified
   * (profile/OTP routes only), `full` otherwise.
   */
  profileScope: 'restricted' | 'full';
}
