import { Inject, Injectable, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createPublicKey } from 'node:crypto';
import { ConfigService } from '../config/config.module.js';
import { CodedException } from '../common/filters/coded.exception.js';

export type SocialProvider = 'GOOGLE' | 'APPLE';

export interface VerifiedProviderIdentity {
  provider: SocialProvider;
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export type FetchFn = (
  input: string,
) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>;

interface JwkSet {
  keys?: ({ kid?: string } & Record<string, unknown>)[];
}

const GOOGLE_ISSUERS = new Set([
  'https://accounts.google.com',
  'accounts.google.com',
]);
const APPLE_ISSUER = 'https://appleid.apple.com';

/** Generic failure — never reveals whether a social account is linked. */
function providerFailed(): CodedException {
  return new CodedException(
    401,
    'AUTHENTICATION_FAILED',
    'Unable to authenticate with the provided credentials.',
  );
}

/**
 * Verifies Google/Apple identity tokens against provider JWKS with zero new
 * dependencies: key transport is global fetch, JWK→PEM is Node crypto, and
 * signature validation rides the existing @nestjs/jwt stack. JWKS responses
 * are cached in memory (best-effort; refetch on kid-miss keeps cold starts
 * and key rotations correct). The raw idToken is never stored or logged.
 */
@Injectable()
export class ProvidersService {
  private readonly keyCache = new Map<
    string,
    { fetchedAt: number; keys: Map<string, string> }
  >();

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @Optional() @Inject('PROVIDERS_FETCH') fetchOverride?: FetchFn,
  ) {
    this.fetchFn = fetchOverride ?? ((url: string) => fetch(url) as never);
  }

  private readonly fetchFn: FetchFn;

  async verify(
    provider: SocialProvider,
    idToken: string,
  ): Promise<VerifiedProviderIdentity> {
    const { jwksUri, issuer, audience, algorithms } =
      this.expectations(provider);
    let header: { kid?: string; alg?: string };
    try {
      const segment = idToken.split('.')[0];
      if (!segment) throw new Error('malformed');
      header = JSON.parse(
        Buffer.from(segment, 'base64url').toString(),
      ) as typeof header;
    } catch {
      throw providerFailed();
    }
    if (!header.kid) throw providerFailed();
    const publicKeyPem = await this.publicKeyFor(jwksUri, header.kid);
    if (!publicKeyPem) throw providerFailed();
    let payload: Record<string, unknown>;
    try {
      payload = await this.jwtService.verifyAsync<Record<string, unknown>>(
        idToken,
        {
          secret: publicKeyPem,
          algorithms,
          issuer: (Array.isArray(issuer) ? issuer : [issuer]) as [
            string,
            ...string[],
          ],
          audience,
        },
      );
    } catch {
      throw providerFailed();
    }
    const providerUserId = payload.sub;
    if (typeof providerUserId !== 'string' || providerUserId.length === 0)
      throw providerFailed();
    const email = typeof payload.email === 'string' ? payload.email : null;
    // Google marks unverified emails explicitly; Apple relay mails are taken
    // as given. Unverifiable contact is treated as absent (phone stays
    // mandatory regardless).
    const emailVerified =
      provider === 'GOOGLE' ? payload.email_verified === true : email !== null;
    const name =
      typeof payload.name === 'string' && payload.name.length > 0
        ? payload.name
        : null;
    return {
      provider,
      providerUserId,
      email: emailVerified ? email : null,
      emailVerified,
      name,
    };
  }

  private expectations(provider: SocialProvider): {
    jwksUri: string;
    issuer: string | string[];
    audience: string;
    algorithms: ('RS256' | 'ES256')[];
  } {
    const passengerAuth = this.config.config.passengerAuth;
    if (provider === 'GOOGLE') {
      if (!passengerAuth.googleClientId) throw providerFailed();
      return {
        jwksUri: passengerAuth.googleJwksUri,
        issuer: [...GOOGLE_ISSUERS],
        audience: passengerAuth.googleClientId,
        algorithms: ['RS256'],
      };
    }
    if (!passengerAuth.appleClientId) throw providerFailed();
    return {
      jwksUri: passengerAuth.appleJwksUri,
      issuer: APPLE_ISSUER,
      audience: passengerAuth.appleClientId,
      algorithms: ['ES256'],
    };
  }

  private async publicKeyFor(
    jwksUri: string,
    kid: string,
  ): Promise<string | null> {
    const cached = this.keyCache.get(jwksUri)?.keys.get(kid);
    if (cached) return cached;
    const pem = await this.fetchKey(jwksUri, kid);
    if (pem) return pem;
    // Kid-miss: drop the cache (rotation) and fetch once more.
    this.keyCache.delete(jwksUri);
    return this.fetchKey(jwksUri, kid);
  }

  private async fetchKey(jwksUri: string, kid: string): Promise<string | null> {
    let set: JwkSet;
    try {
      const response = await this.fetchFn(jwksUri);
      if (!response.ok) return null;
      set = (await response.json()) as JwkSet;
    } catch {
      return null;
    }
    const jwk = set.keys?.find((key) => key.kid === kid);
    if (!jwk) return null;
    let pem: string;
    try {
      pem = createPublicKey({ key: jwk as never, format: 'jwk' }).export({
        format: 'pem',
        type: 'spki',
      }) as string;
    } catch {
      return null;
    }
    const entry = this.keyCache.get(jwksUri) ?? {
      fetchedAt: Date.now(),
      keys: new Map(),
    };
    entry.keys.set(kid, pem);
    this.keyCache.set(jwksUri, entry);
    return pem;
  }
}
