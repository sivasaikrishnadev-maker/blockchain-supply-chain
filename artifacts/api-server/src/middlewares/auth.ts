import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import type { RequestHandler } from "express";
import type { SupplyChainRole } from "@workspace/db";

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: SupplyChainRole;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthenticatedUser;
    }
  }
}

/**
 * In production the signing secret must come from the environment.
 *
 * A short, predictable, or missing secret would let anyone mint valid sessions
 * for any role, so the server refuses to start rather than fall back to a
 * default. There is deliberately no fallback value.
 */
export function getJwtSecret(): string {
  const secret =
    process.env.JWT_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "Set JWT_SECRET (or SESSION_SECRET) before starting the API. There is no default value.",
    );
  }
  if (process.env.NODE_ENV === "production" && secret.length < 32) {
    throw new Error(
      "JWT_SECRET must be at least 32 characters in production.",
    );
  }
  return secret;
}

/**
 * Validate the configured token lifetime.
 *
 * `jsonwebtoken` types `expiresIn` as a number of seconds or a branded
 * "30m"-style string, so an arbitrary environment string is rejected rather
 * than cast. A typo in JWT_EXPIRES_IN therefore fails loudly at startup instead
 * of silently producing a token with the wrong lifetime.
 */
function resolveExpiresIn(): SignOptions["expiresIn"] {
  const configured = process.env.JWT_EXPIRES_IN?.trim();
  if (!configured) return "8h";
  if (/^\d+$/.test(configured)) return Number(configured);
  if (/^\d+(ms|s|m|h|d|w|y)$/.test(configured)) {
    return configured as SignOptions["expiresIn"];
  }
  throw new Error(
    `JWT_EXPIRES_IN is not a valid duration: "${configured}". Use a number of seconds (for example 3600) or a suffixed value such as 30m, 8h, or 7d.`,
  );
}

export function signAuthToken(user: {
  id: string;
  name: string;
  email: string;
  role: SupplyChainRole;
}): string {
  return jwt.sign(
    { name: user.name, email: user.email, role: user.role },
    getJwtSecret(),
    {
      subject: user.id,
      expiresIn: resolveExpiresIn(),
      issuer: "chain-ledger",
      audience: "chain-ledger-web",
    },
  );
}

export const authenticate: RequestHandler = (req, res, next) => {
  const authorization = req.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  try {
    const payload = jwt.verify(token, getJwtSecret(), {
      issuer: "chain-ledger",
      audience: "chain-ledger-web",
    });
    if (
      typeof payload === "string" ||
      typeof payload.sub !== "string" ||
      typeof payload.name !== "string" ||
      typeof payload.email !== "string" ||
      !isRole(payload.role)
    ) {
      res.status(401).json({ error: "Your session is invalid. Please sign in again." });
      return;
    }
    req.authUser = {
      id: payload.sub,
      name: payload.name,
      email: payload.email,
      role: payload.role,
    };
    next();
  } catch {
    res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
};

export function requireRole(...roles: SupplyChainRole[]): RequestHandler {
  return (req, res, next) => {
    if (!req.authUser) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }
    if (!roles.includes(req.authUser.role)) {
      res.status(403).json({ error: "This action is not available for your role." });
      return;
    }
    next();
  };
}

function isRole(value: JwtPayload["role"]): value is SupplyChainRole {
  return value === "manufacturer" || value === "distributor" || value === "retailer";
}
