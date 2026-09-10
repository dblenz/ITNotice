import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { UserRole } from '@itnotice/shared';

/**
 * Issuer-agnostic OIDC bearer-token validation.
 *
 * Configuration (env):
 * - OIDC_ISSUER_URL   e.g. http://localhost:8080/realms/itnotice (required unless AUTH_DISABLED=true)
 * - OIDC_AUDIENCE     expected audience claim (optional)
 * - OIDC_ROLES_CLAIM  dot-path to the roles array in the token
 *                     default: realm_access.roles (Keycloak). Use e.g. "roles" for other IdPs.
 * - AUTH_DISABLED     set to "true" for local development without an IdP;
 *                     all requests act as an admin user "dev.user".
 */

export interface AuthUser {
  id: string;
  username: string;
  email?: string;
  roles: UserRole[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const authDisabled = process.env.AUTH_DISABLED === 'true';
const issuerUrl = process.env.OIDC_ISSUER_URL;
const audience = process.env.OIDC_AUDIENCE;
const rolesClaimPath = (process.env.OIDC_ROLES_CLAIM || 'realm_access.roles').split('.');

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks) {
    if (!issuerUrl) {
      throw new Error('OIDC_ISSUER_URL must be set (or AUTH_DISABLED=true for development).');
    }
    jwks = createRemoteJWKSet(new URL(`${issuerUrl.replace(/\/$/, '')}/protocol/openid-connect/certs`));
  }
  return jwks;
}

function extractRoles(payload: JWTPayload): UserRole[] {
  let value: unknown = payload;
  for (const segment of rolesClaimPath) {
    if (value && typeof value === 'object') value = (value as Record<string, unknown>)[segment];
    else return [];
  }
  if (!Array.isArray(value)) return [];
  const known: UserRole[] = ['admin', 'approver', 'author', 'employee'];
  return value.filter((role): role is UserRole => known.includes(role as UserRole));
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  if (authDisabled) {
    req.user = {
      id: 'dev-user',
      username: 'dev.user',
      email: 'dev.user@example.com',
      roles: ['admin', 'approver', 'author', 'employee'],
    };
    return next();
  }

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing bearer token.' });
  }

  try {
    const { payload } = await jwtVerify(header.slice(7), getJwks(), {
      issuer: issuerUrl,
      audience: audience || undefined,
    });

    req.user = {
      id: String(payload.sub || ''),
      username: String(payload.preferred_username || payload.sub || ''),
      email: typeof payload.email === 'string' ? payload.email : undefined,
      roles: extractRoles(payload),
    };
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'Not authenticated.' });
    if (!roles.some((role) => user.roles.includes(role))) {
      return res.status(403).json({ message: 'Insufficient permissions.' });
    }
    return next();
  };
}
