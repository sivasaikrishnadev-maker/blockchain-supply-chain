import {
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable(
  "supply_chain_users",
  {
    id: text("id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    uniqueIndex("supply_chain_users_email_idx").on(table.email),
  ],
);

export const productsTable = pgTable(
  "supply_chain_products",
  {
    productId: text("product_id").notNull(),
    productName: text("product_name").notNull(),
    batchNumber: text("batch_number").notNull(),
    category: text("category").notNull(),
    manufacturingDate: text("manufacturing_date").notNull(),
    quantity: integer("quantity").notNull(),
    description: text("description").notNull().default(""),
    manufacturer: text("manufacturer").notNull(),
    manufacturerId: text("manufacturer_id").notNull(),
    currentStatus: text("current_status").notNull().default("Created"),
    productHash: text("product_hash").notNull(),
    blockchainHash: text("blockchain_hash").notNull(),
    blockchainTransaction: text("blockchain_transaction").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.productId] })],
);

export const eventsTable = pgTable("supply_chain_events", {
  id: serial("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => productsTable.productId, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  status: text("status").notNull(),
  actor: text("actor").notNull(),
  actorRole: text("actor_role").notNull(),
  eventHash: text("event_hash").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true })
    .notNull()
    .defaultNow(),
  blockchainTransaction: text("blockchain_transaction").notNull().default(""),
});

export const insertSupplyChainUserSchema = createInsertSchema(usersTable);
export const insertSupplyChainProductSchema = createInsertSchema(productsTable);
export const insertSupplyChainEventSchema = createInsertSchema(eventsTable);

export type SupplyChainRole = "manufacturer" | "distributor" | "retailer";
export type SupplyChainUser = typeof usersTable.$inferSelect;
export type SupplyChainProduct = typeof productsTable.$inferSelect;
export type SupplyChainEvent = typeof eventsTable.$inferSelect;
export type InsertSupplyChainUser = z.infer<typeof insertSupplyChainUserSchema>;
export type InsertSupplyChainProduct = z.infer<
  typeof insertSupplyChainProductSchema
>;
export type InsertSupplyChainEvent = z.infer<
  typeof insertSupplyChainEventSchema
>;