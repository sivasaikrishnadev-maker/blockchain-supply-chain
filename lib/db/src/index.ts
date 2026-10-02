import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { resolveSchemaSql } from "./schema-sql";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Fail fast on a connection string that is malformed or unauthenticated, rather
// than discovering it later as a confusing runtime error.
try {
  const parsed = new URL(connectionString);
  if (!parsed.username) {
    throw new Error("DATABASE_URL is missing its username/password component.");
  }
} catch (error) {
  if (error instanceof TypeError) {
    throw new Error("DATABASE_URL is not a valid PostgreSQL connection string.");
  }
  throw error;
}

if (
  process.env.NODE_ENV === "production" &&
  /(^|[?&;])sslmode=disable(&|$)/i.test(connectionString)
) {
  throw new Error(
    "DATABASE_URL disables TLS (sslmode=disable). Use a TLS-protected connection in production.",
  );
}

export const pool = new Pool({
  connectionString,
  // A capped pool keeps a memory-limited free-tier instance from being
  // exhausted by concurrent requests.
  max: Number(process.env.DATABASE_POOL_MAX ?? 5),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});
pool.on("error", (error) => {
  // Log the message only: the connection string contains credentials.
  console.error("Unexpected idle PostgreSQL client error:", error.message);
});

export const db = drizzle(pool, { schema });

/**
 * Create the application tables when they do not exist yet.
 *
 * The project has no migration files, so a brand-new deployment database would
 * otherwise fail every query. This idempotent DDL makes the first boot
 * self-sufficient and is a no-op on an already-provisioned database.
 */
export async function ensureSchema(): Promise<void> {
  await pool.query(resolveSchemaSql());
}

export * from "./schema";
