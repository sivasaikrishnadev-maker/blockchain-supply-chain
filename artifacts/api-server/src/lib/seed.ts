import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Demo accounts exist so the demonstration can be run without a registration
 * flow. Their passwords come from environment variables and are never committed.
 *
 * The local default is only used when NODE_ENV is explicitly "development".
 * Anything else - including NODE_ENV being unset, which is the realistic case on
 * a fresh hosting platform - is treated as production and refuses to fall back to
 * a shared password.
 */

interface DemoUserDefinition {
  id: string;
  name: string;
  email: string;
  role: "manufacturer" | "distributor" | "retailer";
  passwordEnvVar: string;
}

const demoUsers: DemoUserDefinition[] = [
  {
    id: "demo-manufacturer",
    name: "Demo Manufacturer",
    email: "manufacturer@demo.com",
    role: "manufacturer",
    passwordEnvVar: "MANUFACTURER_PASSWORD",
  },
  {
    id: "demo-distributor",
    name: "Demo Distributor",
    email: "distributor@demo.com",
    role: "distributor",
    passwordEnvVar: "DISTRIBUTOR_PASSWORD",
  },
  {
    id: "demo-retailer",
    name: "Demo Retailer",
    email: "retailer@demo.com",
    role: "retailer",
    passwordEnvVar: "RETAILER_PASSWORD",
  },
];

/** Documented local-only default. Never usable outside NODE_ENV=development. */
const DEVELOPMENT_DEFAULT_PASSWORD = "password123";

function isProduction(): boolean {
  return process.env.NODE_ENV !== "development";
}

/**
 * Resolve a demo password, refusing to invent one outside local development.
 */
export function resolveDemoPassword(user: DemoUserDefinition): string {
  const configured = process.env[user.passwordEnvVar]?.trim();
  if (configured) return configured;
  if (isProduction()) {
    throw new Error(
      `${user.passwordEnvVar} must be set to a strong, unique value. ` +
        "The demo accounts are created automatically, so they must never fall back to a shared default password. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(24).toString('base64url'))\"",
    );
  }
  return DEVELOPMENT_DEFAULT_PASSWORD;
}

/**
 * Fail fast if production passwords are missing or too weak.
 *
 * This runs before the account lookup so a database that was seeded during an
 * earlier, weaker deployment cannot silently keep a guessable password: the
 * deployment stops until the owner sets real values and rotates the accounts.
 */
function assertProductionPasswordsAreAcceptable(): void {
  if (!isProduction()) return;
  for (const user of demoUsers) {
    const password = resolveDemoPassword(user);
    if (password.length < 12) {
      throw new Error(
        `${user.passwordEnvVar} must be at least 12 characters. Demo accounts are reachable from the public internet, so a short shared password is not acceptable.`,
      );
    }
  }
  warnIfDemoPasswordsAreReused();
}

export async function seedDemoUsers(): Promise<void> {
  assertProductionPasswordsAreAcceptable();

  const configuredRounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
  const rounds =
    Number.isInteger(configuredRounds) &&
    configuredRounds >= 10 &&
    configuredRounds <= 15
      ? configuredRounds
      : 12;

  let created = 0;
  for (const demoUser of demoUsers) {
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, demoUser.email));
    if (existing) continue;

    const passwordHash = await bcrypt.hash(
      resolveDemoPassword(demoUser),
      rounds,
    );
    // Fields are listed explicitly: spreading demoUser would also write
    // `passwordEnvVar`, which is not a column.
    await db.insert(usersTable).values({
      id: demoUser.id,
      name: demoUser.name,
      email: demoUser.email,
      role: demoUser.role,
      passwordHash,
    });
    created += 1;
  }
  logger.info(
    { total: demoUsers.length, created },
    "Demo role accounts are ready (passwords supplied via environment variables)",
  );
}

/**
 * Warn when two demo accounts share a password.
 *
 * One shared password across the three roles means a single leaked credential
 * grants every role, which defeats the role-based demonstration. Password values
 * are never logged - only the affected role names.
 */
export function warnIfDemoPasswordsAreReused(): void {
  const rolesByPassword = new Map<string, string[]>();
  for (const demoUser of demoUsers) {
    const password = process.env[demoUser.passwordEnvVar]?.trim();
    if (!password) continue;
    const roles = rolesByPassword.get(password) ?? [];
    roles.push(demoUser.role);
    rolesByPassword.set(password, roles);
  }
  for (const roles of rolesByPassword.values()) {
    if (roles.length > 1) {
      logger.warn(
        { roles },
        "Several demo accounts share the same password. Set a unique password per role so one leaked credential cannot unlock every role.",
      );
    }
  }
}