import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { UserRole } from '@taskflow/shared';
import type { Env } from '../config/env';

export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
  /** Session id — lets the API mark the "current" session and bind streams. */
  sid: string;
}

export interface VerifiedAccessToken extends AccessTokenClaims {
  exp: number;
}

const AUDIENCE = 'taskflow-api';

export function signAccessToken(env: Env, claims: AccessTokenClaims): string {
  return jwt.sign(claims, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    issuer: env.JWT_ISSUER,
    audience: AUDIENCE,
  });
}

export function verifyAccessToken(env: Env, token: string): VerifiedAccessToken | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'], // pin the algorithm — never trust the header
      issuer: env.JWT_ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload !== 'object' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return { sub: payload.sub, sid: payload.sid, role: payload.role as UserRole, exp: payload.exp ?? 0 };
  } catch {
    return null;
  }
}

/** 256-bit opaque refresh token. Only its SHA-256 digest is persisted. */
export const generateRefreshToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
