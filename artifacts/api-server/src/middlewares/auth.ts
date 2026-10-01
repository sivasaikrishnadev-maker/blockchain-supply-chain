import type { RequestHandler } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
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

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET ?? process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("Set SESSION_SECRET (or JWT_SECRET) before starting the API.");
  }
  return secret;
}

export const authenticate: RequestHandler = (req, res, next) => {
  const authorization = req.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  try {
    const payload = jwt.verify(token, getJwtSecret());
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