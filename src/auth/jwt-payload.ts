/** Verified JWT claims (never trust an unverified decode). */
export interface JwtPayload {
  sub: string;
  email: string;
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
  email: string;
  appRole: string;
  authVersion: number;
  sessionId: string;
}
