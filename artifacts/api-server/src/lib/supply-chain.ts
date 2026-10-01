import { createHash } from "node:crypto";
import type {
  Product,
  ProductInput,
  SupplyEvent,
} from "@workspace/api-zod";
import type {
  SupplyChainProduct,
  SupplyChainEvent,
  SupplyChainRole,
} from "@workspace/db";

export const supplyStatuses = [
  "Created",
  "Received by Distributor",
  "In Transit to Retailer",
  "Received by Retailer",
  "Available for Sale",
] as const;

export function hashProduct(
  product: ProductInput,
  manufacturer: string,
): string {
  const canonicalFields = [
    product.productId,
    product.productName,
    product.batchNumber,
    product.category,
    product.manufacturingDate,
    product.quantity,
    product.description,
    manufacturer,
  ];
  return createHash("sha256")
    .update(JSON.stringify(canonicalFields))
    .digest("hex");
}

export function hashEvent(event: {
  productId: string;
  eventType: string;
  status: string;
  actor: string;
  actorRole: SupplyChainRole;
  timestamp: Date;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        productId: event.productId,
        eventType: event.eventType,
        status: event.status,
        actor: event.actor,
        actorRole: event.actorRole,
        timestamp: event.timestamp.toISOString(),
      }),
    )
    .digest("hex");
}

export function presentProduct(row: SupplyChainProduct): Product {
  return {
    productId: row.productId,
    productName: row.productName,
    batchNumber: row.batchNumber,
    category: row.category,
    manufacturingDate: row.manufacturingDate,
    quantity: row.quantity,
    description: row.description,
    manufacturer: row.manufacturer,
    currentStatus: row.currentStatus as Product["currentStatus"],
    productHash: row.productHash,
    blockchainHash: row.blockchainHash,
    blockchainTransaction: row.blockchainTransaction,
    createdAt: row.createdAt.toISOString(),
  };
}

export function presentEvent(row: SupplyChainEvent): SupplyEvent {
  return {
    id: String(row.id),
    productId: row.productId,
    eventType: row.eventType,
    status: row.status,
    actor: row.actor,
    actorRole: row.actorRole as SupplyEvent["actorRole"],
    timestamp: row.timestamp.toISOString(),
    blockchainTransaction: row.blockchainTransaction,
  };
}