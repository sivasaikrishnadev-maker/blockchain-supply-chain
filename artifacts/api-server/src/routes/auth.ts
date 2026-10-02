import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { LoginBody, LoginResponse, GetCurrentUserResponse } from "@workspace/api-zod";
import { db, usersTable } from "@workspace/db";
import { authenticate, signAuthToken } from "../middlewares/auth";
import { Router, type IRouter } from "express";

const router: IRouter = Router();

/**
 * Throttle repeated failed sign-in attempts.
 *
 * Without a limit, the login endpoint is an unthrottled oracle for password
 * guessing. The limiter is keyed on IP plus the submitted email so one attacker
 * cannot lock every user out, and it responds with 429 rather than revealing
 * whether the account exists.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT ?? 10),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Count only unsuccessful attempts, so a busy legitimate user is not throttled.
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email =
      typeof req.body === "object" && req.body !== null && "email" in req.body
        ? String((req.body as { email?: unknown }).email ?? "").toLowerCase()
        : "";
    // `ipKeyGenerator` normalises IPv6 addresses to a /56 subnet. Using the raw
    // `req.ip` instead lets a single client rotate through its IPv6 prefix and
    // bypass the limit entirely.
    return `${ipKeyGenerator(req.ip ?? "unknown")}:${email}`;
  },
  message: {
    error: "Too many sign-in attempts. Please wait a few minutes and try again.",
  },
});

router.post("/auth/login", loginLimiter, async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email address and password." });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, parsed.data.email.toLowerCase()));

  // Run the same bcrypt comparison whether or not the account exists, so the
  // response time does not reveal which emails are registered.
  const passwordHash = user?.passwordHash ?? DUMMY_HASH;
  const passwordMatches = await bcrypt.compare(parsed.data.password, passwordHash);

  if (!user || !passwordMatches) {
    res.status(401).json({ error: "The email or password is incorrect." });
    return;
  }

  const token = signAuthToken({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as "manufacturer" | "distributor" | "retailer",
  });
  res.json(
    LoginResponse.parse({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    }),
  );
});

router.get("/auth/me", authenticate, async (req, res): Promise<void> => {
  res.json(
    GetCurrentUserResponse.parse({
      id: req.authUser!.id,
      name: req.authUser!.name,
      email: req.authUser!.email,
      role: req.authUser!.role,
    }),
  );
});

/**
 * A valid bcrypt hash of a value nobody knows. Comparing against it costs the
 * same as a real comparison, which keeps the unknown-account path constant-time.
 */
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.7Qq3Rk1lN0HqfEUoXhSpHXlqzHnCx0O";

export default router;
