import { existsSync, readFileSync } from "node:fs";

/**
 * Idempotent bootstrap DDL that mirrors `src/schema/supply-chain.ts`.
 *
 * The project ships no Drizzle migration files (Drizzle is used through
 * `push`), so a freshly provisioned database has no tables at all. Running this
 * conditional DDL at startup gives a first boot a working schema without a
 * separate migration step.
 *
 * Every statement is `IF NOT EXISTS`, so this is a no-op on a database that is
 * already provisioned. It is intentionally *not* a migration system: if the
 * schema changes after the first deployment, tables must be migrated manually
 * with `pnpm run db:push`.
 */
export const bootstrapSchemaSql = `-- Idempotent bootstrap DDL for the chain-ledger demo schema.
-- Mirrors src/schema/supply-chain.ts.

CREATE TABLE IF NOT EXISTS "supply_chain_users" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "password_hash" text NOT NULL,
  "role" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "supply_chain_users_email_idx" ON "supply_chain_users" ("email");

CREATE TABLE IF NOT EXISTS "supply_chain_products" (
  "product_id" text PRIMARY KEY NOT NULL,
  "product_name" text NOT NULL,
  "batch_number" text NOT NULL,
  "category" text NOT NULL,
  "manufacturing_date" text NOT NULL,
  "quantity" integer NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "manufacturer" text NOT NULL,
  "manufacturer_id" text NOT NULL,
  "current_status" text DEFAULT 'Created' NOT NULL,
  "product_hash" text NOT NULL,
  "blockchain_hash" text NOT NULL,
  "blockchain_transaction" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "supply_chain_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "product_id" text NOT NULL REFERENCES "supply_chain_products" ("product_id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "status" text NOT NULL,
  "actor" text NOT NULL,
  "actor_role" text NOT NULL,
  "event_hash" text NOT NULL,
  "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
  "blockchain_transaction" text DEFAULT '' NOT NULL
);
-- Not declared in the Drizzle schema, but the event timeline and the
-- restore-on-startup replay both look events up by product_id, and PostgreSQL
-- does not index the referencing side of a foreign key automatically.
CREATE INDEX IF NOT EXISTS "supply_chain_events_product_id_idx" ON "supply_chain_events" ("product_id");
`;

/**
 * Resolve the DDL to execute, preferring an operator-supplied file so the SQL
 * can be corrected without touching the code. `SCHEMA_SQL_PATH` is an operator
 * override only and must never point at an untrusted location.
 */
export function resolveSchemaSql(): string {
  const override = process.env["SCHEMA_SQL_PATH"];
  if (!override) {
    return bootstrapSchemaSql;
  }
  if (!existsSync(override)) {
    throw new Error(
      `SCHEMA_SQL_PATH was set to "${override}" but no such file exists.`,
    );
  }
  return readFileSync(override, "utf8");
}
