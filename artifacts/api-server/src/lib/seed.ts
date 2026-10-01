import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "./logger";

const demoUsers = [
  {
    id: "demo-manufacturer",
    name: "Demo Manufacturer",
    email: "manufacturer@demo.com",
    role: "manufacturer",
  },
  {
    id: "demo-distributor",
    name: "Demo Distributor",
    email: "distributor@demo.com",
    role: "distributor",
  },
  {
    id: "demo-retailer",
    name: "Demo Retailer",
    email: "retailer@demo.com",
    role: "retailer",
  },
] as const;

export async function seedDemoUsers(): Promise<void> {
  const passwordHash = await bcrypt.hash("password123", 10);
  for (const demoUser of demoUsers) {
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, demoUser.email));
    if (existing) continue;
    await db.insert(usersTable).values({ ...demoUser, passwordHash });
  }
  logger.info({ count: demoUsers.length }, "Demo role accounts are ready");
}