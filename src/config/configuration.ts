export interface JwtConfig {
  secret: string;
  issuer: string;
  audience: string;
  expiresIn: string;
}

export interface ObserveConfig {
  appKey?: string;
  appSecret?: string;
  serviceId: string;
}

export interface CorsConfig {
  allowedOrigins: string[];
}

export interface AppConfig {
  port: number;
  env: string;
  cors: CorsConfig;
  database: {
    /** Connection used by every normal (RLS-enforced) tenant request path. */
    tenantUrl: string;
    /** Privileged owner connection: migrations, seed, platform-admin endpoints. */
    systemUrl: string;
  };
  jwt: JwtConfig;
  seed: {
    superAdminEmail?: string;
    superAdminPassword?: string;
  };
  passengerAuth: {
    /** Temporary fixed OTP until an SMS provider is chosen (spec 002 FR-007). */
    fixedOtpCode: string;
    googleClientId?: string;
    appleClientId?: string;
    /** Overridable for tests; production defaults are the provider endpoints. */
    googleJwksUri: string;
    appleJwksUri: string;
  };
  observe: ObserveConfig;
  storage: {
    /** Supabase Storage for bus images; undefined until configured. */
    supabaseUrl?: string;
    supabaseServiceRoleKey?: string;
  };
  promotions: {
    /** Global kill-switch for per-user reuse counting (spec 011). Default ON. */
    enforceOncePerUser: boolean;
    /** Default discount type preselected by the dashboard create form. */
    defaultType: string;
  };
}

const DURATION_PATTERN = /^\d+([smhd])?$/;
const OBSERVE_PLACEHOLDERS = new Set(['', 'YOUR_APP_KEY', 'YOUR_APP_SECRET']);

/**
 * Observe telemetry activates only with real credentials: placeholder or
 * missing keys return null so the agent is never started (it would otherwise
 * 401 against the collector forever without recovering).
 */
export function resolveObserveCredentials(
  env: NodeJS.ProcessEnv = process.env,
): { appKey: string; appSecret: string; serviceId: string } | null {
  const appKey = env.OBSERVE_APP_KEY ?? '';
  const appSecret = env.OBSERVE_APP_SECRET ?? '';
  if (OBSERVE_PLACEHOLDERS.has(appKey) || OBSERVE_PLACEHOLDERS.has(appSecret))
    return null;
  return { appKey, appSecret, serviceId: env.OBSERVE_SERVICE_ID ?? 'bus' };
}

function collectProblems(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];
  const isTest = env.NODE_ENV === 'test';

  const tenantUrl =
    (isTest ? (env.TEST_DATABASE_URL ?? env.DATABASE_URL) : env.DATABASE_URL) ??
    '';
  if (!tenantUrl) problems.push('DATABASE_URL');
  const systemUrl =
    (isTest ? (env.TEST_DIRECT_URL ?? env.DIRECT_URL) : env.DIRECT_URL) ?? '';
  if (!systemUrl) problems.push('DIRECT_URL');

  const secret = env.JWT_SECRET ?? '';
  if (secret.length < 32) problems.push('JWT_SECRET (min 32 chars)');
  if (!env.JWT_ISSUER) problems.push('JWT_ISSUER');
  if (!env.JWT_AUDIENCE) problems.push('JWT_AUDIENCE');
  const expiresIn = env.JWT_EXPIRES_IN ?? '';
  if (!DURATION_PATTERN.test(expiresIn)) {
    problems.push(
      'JWT_EXPIRES_IN (invalid duration, use e.g. 900, 15m, 1h, 7d)',
    );
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535)
    problems.push('PORT (invalid)');

  const fixedOtpCode = env.OTP_FIXED_CODE ?? '123456';
  if (!/^\d{6}$/.test(fixedOtpCode))
    problems.push('OTP_FIXED_CODE (must be 6 digits)');

  return problems;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const problems = collectProblems(env);
  if (problems.length > 0) {
    throw new Error(`Invalid configuration: ${problems.join(', ')}`);
  }

  const isTest = env.NODE_ENV === 'test';
  return {
    port: Number(env.PORT ?? 3000),
    env: env.NODE_ENV ?? 'development',
    cors: {
      allowedOrigins: env.CORS_ALLOWED_ORIGINS
        ? env.CORS_ALLOWED_ORIGINS.split(',')
            .map((o) => o.trim())
            .filter(Boolean)
        : isTest || env.NODE_ENV === 'development' || !env.NODE_ENV
          ? ['http://localhost:3000', 'http://127.0.0.1:3000']
          : [],
    },
    database: {
      tenantUrl: (isTest
        ? (env.TEST_DATABASE_URL ?? env.DATABASE_URL)
        : env.DATABASE_URL) as string,
      systemUrl: (isTest
        ? (env.TEST_DIRECT_URL ?? env.DIRECT_URL)
        : env.DIRECT_URL) as string,
    },
    jwt: {
      secret: env.JWT_SECRET as string,
      issuer: env.JWT_ISSUER as string,
      audience: env.JWT_AUDIENCE as string,
      expiresIn: env.JWT_EXPIRES_IN as string,
    },
    seed: {
      superAdminEmail: env.SEED_SUPER_ADMIN_EMAIL,
      superAdminPassword: env.SEED_SUPER_ADMIN_PASSWORD,
    },
    passengerAuth: {
      fixedOtpCode: env.OTP_FIXED_CODE ?? '123456',
      googleClientId: env.GOOGLE_CLIENT_ID || undefined,
      appleClientId: env.APPLE_CLIENT_ID || undefined,
      googleJwksUri:
        env.GOOGLE_JWKS_URI || 'https://www.googleapis.com/oauth2/v3/certs',
      appleJwksUri: env.APPLE_JWKS_URI || 'https://appleid.apple.com/auth/keys',
    },
    observe: resolveObserveCredentials(env) ?? {
      serviceId: env.OBSERVE_SERVICE_ID ?? 'bus',
    },
    storage: {
      supabaseUrl: env.SUPABASE_URL || undefined,
      supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || undefined,
    },
    promotions: {
      enforceOncePerUser: env.PROMO_ENFORCE_ONCE_PER_USER !== 'false',
      defaultType: env.PROMO_DEFAULT_TYPE ?? 'percentage',
    },
  };
}
