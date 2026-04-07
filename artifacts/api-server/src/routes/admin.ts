import { Router, Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable, userSettingsTable, accountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { botInstances, disconnectBotInstance, deleteBotSession } from "../bot/manager.js";
import { stopPresence } from "../bot/presence.js";
import { clearDatabaseSession } from "../bot/db-auth-state.js";

const router = Router();

function getAdminCredentials(): { username: string; key: string } | null {
  const key = process.env.ADMIN_KEY;
  if (!key) return null;
  const username = process.env.ADMIN_USERNAME || "nutterx";
  return { username, key };
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const creds = getAdminCredentials();
  if (!creds) {
    res.status(500).json({ error: "Admin key not configured" });
    return;
  }

  const token = req.headers["x-admin-token"] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(token, "base64").toString();
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  const colonIdx = decoded.indexOf(":");
  if (colonIdx < 0) {
    res.status(401).json({ error: "Invalid token format" });
    return;
  }

  const user = decoded.slice(0, colonIdx);
  const key = decoded.slice(colonIdx + 1);

  if (user !== creds.username || key !== creds.key) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  next();
}

router.post("/admin/login", (req, res) => {
  const creds = getAdminCredentials();
  if (!creds) {
    res.status(500).json({ error: "Admin key not configured" });
    return;
  }

  const { username, adminKey } = req.body as { username: string; adminKey: string };

  if (username !== creds.username || adminKey !== creds.key) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = Buffer.from(`${username}:${adminKey}`).toString("base64");
  res.json({ token, username });
});

router.get("/admin/accounts", requireAdmin, async (_req, res) => {
  const accounts = await db.select({
    id: accountsTable.id,
    email: accountsTable.email,
    username: accountsTable.username,
    createdAt: accountsTable.createdAt,
  }).from(accountsTable);

  const bots = await db.select().from(usersTable);

  const result = accounts.map(a => ({
    ...a,
    bots: bots
      .filter(b => b.accountId === a.id)
      .map(b => ({
        id: b.id,
        name: b.name,
        phone: b.phone,
        status: b.status,
        linkedAt: b.linkedAt,
        lastSeen: b.lastSeen,
        connected: botInstances.get(b.id)?.connected === true,
      })),
  }));

  res.json(result);
});

router.get("/admin/bots", requireAdmin, async (_req, res) => {
  const bots = await db.select().from(usersTable);
  const result = bots.map(b => ({
    id: b.id,
    accountId: b.accountId,
    name: b.name,
    phone: b.phone,
    status: b.status,
    sessionId: b.sessionId,
    linkedAt: b.linkedAt,
    lastSeen: b.lastSeen,
    isFirstConnection: b.isFirstConnection,
    connected: botInstances.get(b.id)?.connected === true,
  }));
  res.json(result);
});

router.get("/admin/accounts/:id", requireAdmin, async (req: Request<{ id: string }>, res) => {
  const { id } = req.params;
  const [account] = await db
    .select({ id: accountsTable.id, email: accountsTable.email, username: accountsTable.username, createdAt: accountsTable.createdAt })
    .from(accountsTable)
    .where(eq(accountsTable.id, id));

  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  const bots = await db.select().from(usersTable).where(eq(usersTable.accountId, id));
  const botDetails = await Promise.all(bots.map(async b => {
    const [settings] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, b.id));
    return {
      id: b.id,
      name: b.name,
      phone: b.phone,
      status: b.status,
      sessionId: b.sessionId,
      linkedAt: b.linkedAt,
      lastSeen: b.lastSeen,
      isFirstConnection: b.isFirstConnection,
      connected: botInstances.get(b.id)?.connected === true,
      settings: settings ?? null,
    };
  }));

  res.json({ ...account, bots: botDetails });
});

router.get("/admin/bots/:id/settings", requireAdmin, async (req: Request<{ id: string }>, res) => {
  const [settings] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, req.params.id));
  if (!settings) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(settings);
});

router.post("/admin/bots/:id/disconnect", requireAdmin, async (req: Request<{ id: string }>, res) => {
  const { id } = req.params;
  await disconnectBotInstance(id);
  stopPresence(id);
  await db.update(usersTable).set({ status: "paused", lastSeen: new Date() }).where(eq(usersTable.id, id));
  res.json({ success: true });
});

router.post("/admin/bots/:id/suspend", requireAdmin, async (req: Request<{ id: string }>, res) => {
  const { id } = req.params;
  await db.update(usersTable).set({ status: "suspended", lastSeen: new Date() }).where(eq(usersTable.id, id));
  await disconnectBotInstance(id);
  stopPresence(id);
  res.json({ success: true });
});

router.post("/admin/bots/:id/activate", requireAdmin, async (req: Request<{ id: string }>, res) => {
  const { id } = req.params;
  const [bot] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }
  await db.update(usersTable).set({ status: "active" }).where(eq(usersTable.id, id));
  res.json({ success: true });
});

router.delete("/admin/bots/:id", requireAdmin, async (req: Request<{ id: string }>, res) => {
  const { id } = req.params;
  const [bot] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  await deleteBotSession(id);
  // Also clear the DB session row by sessionId — covers the case where no active instance exists
  if (bot?.sessionId) await clearDatabaseSession(bot.sessionId);
  stopPresence(id);
  await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, id));
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.json({ success: true });
});

router.delete("/admin/accounts/:id", requireAdmin, async (req: Request<{ id: string }>, res) => {
  const { id } = req.params;
  const bots = await db.select().from(usersTable).where(eq(usersTable.accountId, id));
  for (const bot of bots) {
    await deleteBotSession(bot.id);
    // Also clear the DB session row by sessionId — covers the case where no active instance exists
    if (bot.sessionId) await clearDatabaseSession(bot.sessionId);
    stopPresence(bot.id);
    await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, bot.id));
    await db.delete(usersTable).where(eq(usersTable.id, bot.id));
  }
  await db.delete(accountsTable).where(eq(accountsTable.id, id));
  res.json({ success: true });
});

export default router;
