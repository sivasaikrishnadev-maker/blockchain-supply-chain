import {
  CreateProductBody,
  CreateProductResponse,
  GetDashboardStatsResponse,
  GetProductEventsParams,
  GetProductEventsResponse,
  GetProductParams,
  GetProductResponse,
  GetProductsResponse,
  MarkProductAvailableParams,
  MarkProductAvailableResponse,
  RetailerReceiveParams,
  RetailerReceiveResponse,
  VerifyProductParams,
  VerifyProductResponse,
  DistributorReceiveParams,
  DistributorReceiveResponse,
  DistributorTransferParams,
  DistributorTransferResponse,
} from "@workspace/api-zod";
import type {
  DashboardStats,
  ProductDetails,
  Verification,
} from "@workspace/api-zod";
import {
  db,
  eventsTable,
  productsTable,
  type SupplyChainEvent,
  type SupplyChainProduct,
} from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import {
  addEventOnChain,
  readProductFromChain,
  registerProductOnChain,
} from "../lib/blockchain";
import { HttpError } from "../lib/http-error";
import { authenticate, requireRole } from "../middlewares/auth";
import {
  hashEvent,
  hashProduct,
  presentEvent,
  presentProduct,
} from "../lib/supply-chain";

const router: IRouter = Router();
const distributorStatuses = [
  "Created",
  "Received by Distributor",
  "In Transit to Retailer",
];
const retailerStatuses = [
  "In Transit to Retailer",
  "Received by Retailer",
  "Available for Sale",
];

async function loadProductDetails(productId: string): Promise<ProductDetails | null> {
  const [row] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.productId, productId));
  if (!row) return null;

  const events = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.productId, productId))
    .orderBy(eventsTable.timestamp);
  return {
    product: presentProduct(row),
    events: events.map(presentEvent),
  };
}

/**
 * Parse and normalise a `:productId` route parameter.
 *
 * Every mutating route used `.parse()`, which threw a raw `ZodError` and
 * surfaced as an opaque 500. Using `safeParse` returns a 400 with a stable
 * message for malformed input, which is what a client should see.
 *
 * The length cap matters because the value is hashed, stored, and used as a
 * mapping key on the ledger; an unbounded string would let a caller write
 * megabytes into the database.
 */
const MAX_PRODUCT_ID_LENGTH = 128;

function assertValidProductId(productId: unknown): string {
  const trimmed = typeof productId === "string" ? productId.trim() : "";
  if (!trimmed || trimmed.length > MAX_PRODUCT_ID_LENGTH) {
    throw new HttpError(400, "Enter a valid Product ID.");
  }
  return trimmed;
}

function productIdFrom(request: Request): string {
  const params = GetProductParams.safeParse(request.params);
  if (!params.success) {
    throw new HttpError(400, "Enter a valid Product ID.");
  }
  return assertValidProductId(params.data.productId);
}

router.get(
  "/dashboard/stats",
  authenticate,
  async (req, res): Promise<void> => {
    const rows = await visibleProducts(req.authUser!.id, req.authUser!.role);
    const inProgressStatuses = new Set([
      "Received by Distributor",
      "In Transit to Retailer",
      "Received by Retailer",
    ]);
    const stats: DashboardStats = {
      totalProducts: rows.length,
      created: rows.filter((row) => row.currentStatus === "Created").length,
      inSupplyChain: rows.filter((row) => inProgressStatuses.has(row.currentStatus))
        .length,
      available: rows.filter((row) => row.currentStatus === "Available for Sale")
        .length,
    };
    res.json(GetDashboardStatsResponse.parse(stats));
  },
);

router.get("/products", authenticate, async (req, res): Promise<void> => {
  const rows = await visibleProducts(req.authUser!.id, req.authUser!.role);
  res.json(GetProductsResponse.parse(rows.map(presentProduct)));
});

router.post(
  "/products",
  authenticate,
  requireRole("manufacturer"),
  async (req, res): Promise<void> => {
    const parsed = CreateProductBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Complete all required product fields." });
      return;
    }

    const input = parsed.data;
    const [existingProduct] = await db
      .select({ productId: productsTable.productId })
      .from(productsTable)
      .where(eq(productsTable.productId, input.productId));
    if (existingProduct) {
      res.status(409).json({ error: "That Product ID is already registered." });
      return;
    }
    const manufacturer = req.authUser!.name;
    const productHash = hashProduct(input, manufacturer);
    const timestamp = new Date();
    const eventType = "Created";
    const eventHash = hashEvent({
      productId: input.productId,
      eventType,
      status: "Created",
      actor: manufacturer,
      actorRole: "manufacturer",
      timestamp,
    });

    let product: SupplyChainProduct;
    let createdEvent: SupplyChainEvent;
    try {
      const inserted = await db.transaction(async (tx) => {
        const [savedProduct] = await tx
          .insert(productsTable)
          .values({
            ...input,
            manufacturer,
            manufacturerId: req.authUser!.id,
            currentStatus: "Created",
            productHash,
            blockchainHash: productHash,
          })
          .returning();
        const [savedEvent] = await tx
          .insert(eventsTable)
          .values({
            productId: input.productId,
            eventType,
            status: "Created",
            actor: manufacturer,
            actorRole: "manufacturer",
            eventHash,
            timestamp,
          })
          .returning();
        return { product: savedProduct, event: savedEvent };
      });
      product = inserted.product;
      createdEvent = inserted.event;
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "That Product ID is already registered." });
        return;
      }
      throw error;
    }

    try {
      const registrationTx = await registerProductOnChain(
        input.productId,
        productHash,
      );
      const eventTx = await addEventOnChain(
        input.productId,
        eventType,
        eventHash,
      );
      await db.transaction(async (tx) => {
        await tx
          .update(productsTable)
          .set({ blockchainTransaction: registrationTx })
          .where(eq(productsTable.productId, input.productId));
        await tx
          .update(eventsTable)
          .set({ blockchainTransaction: eventTx })
          .where(eq(eventsTable.id, createdEvent.id));
      });
    } catch {
      await db.delete(eventsTable).where(eq(eventsTable.id, createdEvent.id));
      await db
        .delete(productsTable)
        .where(eq(productsTable.productId, input.productId));
      throw new HttpError(
        503,
        "Blockchain registration failed. The product was not saved; check the local chain and try again.",
      );
    }

    const response = CreateProductResponse.parse(presentProduct(product));
    res.status(201).json({
      ...response,
      blockchainTransaction: (
        await loadProductDetails(input.productId)
      )?.product.blockchainTransaction,
    });
  },
);

router.get("/products/:productId", async (req, res): Promise<void> => {
  const details = await loadProductDetails(productIdFrom(req));
  if (!details) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  res.json(GetProductResponse.parse(details));
});

router.get(
  "/products/:productId/events",
  async (req, res): Promise<void> => {
    const parsed = GetProductEventsParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter a valid Product ID." });
      return;
    }
    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.productId, parsed.data.productId))
      .orderBy(eventsTable.timestamp);
    res.json(
      GetProductEventsResponse.parse(events.map(presentEvent)),
    );
  },
);

router.get(
  "/products/:productId/verify",
  async (req, res): Promise<void> => {
    const parsed = VerifyProductParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter a valid Product ID." });
      return;
    }
    const [row] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.productId, parsed.data.productId));
    if (!row) {
      res.status(404).json({ error: "Product not found." });
      return;
    }

    const recalculatedHash = hashProduct(
      {
        productId: row.productId,
        productName: row.productName,
        batchNumber: row.batchNumber,
        category: row.category,
        manufacturingDate: row.manufacturingDate,
        quantity: row.quantity,
        description: row.description,
      },
      row.manufacturer,
    );
    let chainProduct: Awaited<ReturnType<typeof readProductFromChain>>;
    try {
      chainProduct = await readProductFromChain(row.productId);
    } catch {
      // An unreachable chain must not be reported as "Record Has Been
      // Modified", which would be a false integrity failure. 503 is honest:
      // the stored record is fine, the comparison could not be performed.
      res.status(503).json({
        error:
          "The integrity check is temporarily unavailable because the ledger could not be reached. Please try again shortly.",
      });
      return;
    }

    const verified =
      chainProduct.exists && recalculatedHash === chainProduct.productHash;
    const verification: Verification = {
      verified,
      message: verified
        ? "Record Integrity Verified"
        : "Record Has Been Modified",
      productHash: recalculatedHash,
      blockchainHash: chainProduct.productHash,
      product: presentProduct(row),
    };
    res.json(VerifyProductResponse.parse(verification));
  },
);

router.post(
  "/products/:productId/receive",
  authenticate,
  requireRole("distributor"),
  async (req, res): Promise<void> => {
    const params = DistributorReceiveParams.safeParse(req.params);
    if (!params.success) throw new HttpError(400, "Enter a valid Product ID.");
    const details = await transitionProduct(
      assertValidProductId(params.data.productId),
      "Created",
      "Received by Distributor",
      req.authUser!.name,
      "distributor",
    );
    res.json(DistributorReceiveResponse.parse(details));
  },
);

router.post(
  "/products/:productId/transfer",
  authenticate,
  requireRole("distributor"),
  async (req, res): Promise<void> => {
    const params = DistributorTransferParams.safeParse(req.params);
    if (!params.success) throw new HttpError(400, "Enter a valid Product ID.");
    const details = await transitionProduct(
      assertValidProductId(params.data.productId),
      "Received by Distributor",
      "In Transit to Retailer",
      req.authUser!.name,
      "distributor",
    );
    res.json(DistributorTransferResponse.parse(details));
  },
);

router.post(
  "/products/:productId/retailer-receive",
  authenticate,
  requireRole("retailer"),
  async (req, res): Promise<void> => {
    const params = RetailerReceiveParams.safeParse(req.params);
    if (!params.success) throw new HttpError(400, "Enter a valid Product ID.");
    const details = await transitionProduct(
      assertValidProductId(params.data.productId),
      "In Transit to Retailer",
      "Received by Retailer",
      req.authUser!.name,
      "retailer",
    );
    res.json(RetailerReceiveResponse.parse(details));
  },
);

router.post(
  "/products/:productId/available",
  authenticate,
  requireRole("retailer"),
  async (req, res): Promise<void> => {
    const params = MarkProductAvailableParams.safeParse(req.params);
    if (!params.success) throw new HttpError(400, "Enter a valid Product ID.");
    const details = await transitionProduct(
      assertValidProductId(params.data.productId),
      "Received by Retailer",
      "Available for Sale",
      req.authUser!.name,
      "retailer",
    );
    res.json(MarkProductAvailableResponse.parse(details));
  },
);

async function visibleProducts(
  userId: string,
  role: "manufacturer" | "distributor" | "retailer",
): Promise<SupplyChainProduct[]> {
  if (role === "manufacturer") {
    return db
      .select()
      .from(productsTable)
      .where(eq(productsTable.manufacturerId, userId))
      .orderBy(desc(productsTable.createdAt));
  }
  return db
    .select()
    .from(productsTable)
    .where(
      inArray(
        productsTable.currentStatus,
        role === "distributor" ? distributorStatuses : retailerStatuses,
      ),
    )
    .orderBy(desc(productsTable.createdAt));
}

async function transitionProduct(
  productId: string,
  requiredStatus: string,
  nextStatus: string,
  actor: string,
  actorRole: "distributor" | "retailer",
): Promise<ProductDetails> {
  const timestamp = new Date();
  const eventType = nextStatus;
  const eventHash = hashEvent({
    productId,
    eventType,
    status: nextStatus,
    actor,
    actorRole,
    timestamp,
  });

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(productsTable)
      .where(eq(productsTable.productId, productId))
      .for("update");
    if (!current) {
      throw new HttpError(404, "Product not found.");
    }
    if (current.currentStatus !== requiredStatus) {
      throw new HttpError(
        409,
        `This product is ${current.currentStatus}; it cannot move to ${nextStatus} yet.`,
      );
    }

    let blockchainTransaction: string;
    try {
      blockchainTransaction = await addEventOnChain(
        productId,
        eventType,
        eventHash,
      );
    } catch {
      throw new HttpError(
        503,
        "Blockchain event recording failed. No status change was saved.",
      );
    }
    await tx
      .update(productsTable)
      .set({ currentStatus: nextStatus })
      .where(eq(productsTable.productId, productId));
    await tx.insert(eventsTable).values({
      productId,
      eventType,
      status: nextStatus,
      actor,
      actorRole,
      eventHash,
      timestamp,
      blockchainTransaction,
    });
  });

  const details = await loadProductDetails(productId);
  if (!details) {
    throw new HttpError(404, "Product not found.");
  }
  return details;
}

function isUniqueViolation(error: unknown, depth = 0): boolean {
  if (depth > 3 || typeof error !== "object" || error === null) {
    return false;
  }
  if ("code" in error && error.code === "23505") {
    return true;
  }
  return "cause" in error && isUniqueViolation(error.cause, depth + 1);
}

export default router;
