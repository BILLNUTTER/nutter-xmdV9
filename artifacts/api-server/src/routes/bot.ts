import { Router, Request } from "express";
import { v4 as uuidv4 } from "uuid";
import { db } from "@workspace/db";
import { usersTable, userSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { initiatePairing, botInstances } from "../bot/manager.js";

const router = Router();

router.post("/bot/pair", async (req, res) => {
  const { phone } = req.body as { phone: string };
  if (!phone) {
    res.status(400).json({ error: "Phone number required" });
    return;
  }

  const cleanPhone = phone.replace(/[^0-9]/g, "");
  if (!cleanPhone || cleanPhone.length < 7) {
    res.status(400).json({ error: "Invalid phone number" });
    return;
  }

  let [user] = await db.select().from(usersTable).where(eq(usersTable.phone, cleanPhone));

  if (!user) {
    const userId = uuidv4();
    const sessionId = uuidv4();
    [user] = await db.insert(usersTable).values({
      id: userId,
      phone: cleanPhone,
      sessionId,
      status: "active",
      isFirstConnection: "true",
    }).returning();

    await db.insert(userSettingsTable).values({ userId }).onConflictDoNothing();
  }

  if (user.status === "suspended") {
    res.status(403).json({ error: "Account suspended" });
    return;
  }
  if (user.status === "paused") {
    await db.update(usersTable).set({ status: "active" }).where(eq(usersTable.id, user.id));
  }

  const existing = botInstances.get(user.id);
  if (existing?.connected) {
    const userToken = Buffer.from(`${user.id}:${user.sessionId}`).toString("base64");
    res.json({ pairingCode: null, userId: user.id, userToken, message: "Bot already connected" });
    return;
  }

  try {
    const code = await initiatePairing(user.id, cleanPhone);
    await db.update(usersTable).set({ linkedAt: new Date() }).where(eq(usersTable.id, user.id));
    const [updatedUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    const userToken = Buffer.from(`${user.id}:${updatedUser?.sessionId || user.sessionId}`).toString("base64");
    res.json({ pairingCode: code, userId: user.id, userToken });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate pairing code";
    res.status(500).json({ error: message });
  }
});

router.get("/bot/status/:userId", async (req: Request<{ userId: string }>, res) => {
  const userId = req.params.userId;
  const rawToken = req.headers["x-user-token"] as string | undefined;
  if (!rawToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  let tokenUserId: string;
  let tokenSessionId: string;
  try {
    const decoded = Buffer.from(rawToken, "base64").toString("utf8");
    const parts = decoded.split(":");
    tokenUserId = parts[0] ?? "";
    tokenSessionId = parts[1] ?? "";
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  if (tokenUserId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (user.sessionId !== tokenSessionId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const instance = botInstances.get(userId);
  res.json({
    connected: instance?.connected === true,
    status: user.status,
    phone: user.phone,
    lastSeen: user.lastSeen,
  });
});

export default router;
