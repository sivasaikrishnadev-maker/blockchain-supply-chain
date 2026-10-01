import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { LoginBody, LoginResponse, GetCurrentUserResponse } from "@workspace/api-zod";
import { db, usersTable } from "@workspace/db";
import { authenticate, getJwtSecret } from "../middlewares/auth";
import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email address and password." });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, parsed.data.email.toLowerCase()));

  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: "The email or password is incorrect." });
    return;
  }

  const token = jwt.sign(
    {
      name: user.name,
      email: user.email,
      role: user.role,
    },
    getJwtSecret(),
    { subject: user.id, expiresIn: "8h" },
  );
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

export default router;