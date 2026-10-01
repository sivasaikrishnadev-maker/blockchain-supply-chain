import { asc, eq } from "drizzle-orm";
import { db, eventsTable, productsTable } from "@workspace/db";
import { addEventOnChain, registerProductOnChain } from "./blockchain";
import { logger } from "./logger";

export async function restoreBlockchainState(): Promise<void> {
  const products = await db
    .select()
    .from(productsTable)
    .orderBy(asc(productsTable.createdAt));

  let restoredEvents = 0;
  for (const product of products) {
    const registrationTransaction = await registerProductOnChain(
      product.productId,
      product.productHash,
    );
    await db
      .update(productsTable)
      .set({ blockchainTransaction: registrationTransaction })
      .where(eq(productsTable.productId, product.productId));

    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.productId, product.productId))
      .orderBy(asc(eventsTable.id));
    for (const event of events) {
      const transaction = await addEventOnChain(
        product.productId,
        event.eventType,
        event.eventHash,
      );
      await db
        .update(eventsTable)
        .set({ blockchainTransaction: transaction })
        .where(eq(eventsTable.id, event.id));
      restoredEvents += 1;
    }
  }

  logger.info(
    { products: products.length, events: restoredEvents },
    "Persisted supply-chain records restored to the new ledger",
  );
}