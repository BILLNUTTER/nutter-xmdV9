import { Router, Request } from "express";
import { v4 as uuidv4 } from "uuid";
import { db } from "@workspace/db";
import { usersTable, userSettingsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import {
  botInstances,
  initiatePairing,
  initiateQR,
  pendingQRCodes,
  deleteBotSession,
  disconnectBotInstance,
} from "../bot/manager.js";
import { stopPresence } from "../bot/presence.js";

const router = Router();

type AuthRequest = Request & { accountId?: string };

async function getBotForAccount(botId: string, accountId: string) {
  const [bot] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.id, botId), eq(usersTable.accountId, accountId)));
  return bot ?? null;
}

router.get("/bots", requireAuth, async (req: AuthRequest, res) => {
  const accountId = req.accountId!;
  const bots = await db.select().from(usersTable).where(eq(usersTable.accountId, accountId));
  const result = bots.map((b) => ({
    id: b.id,
    name: b.name,
    phone: b.phone,
    status: b.status,
    linkedAt: b.linkedAt,
    lastSeen: b.lastSeen,
    isFirstConnection: b.isFirstConnection,
    connected: botInstances.get(b.id)?.connected === true,
    hasQR: pendingQRCodes.has(b.id),
  }));
  res.json(result);
});

router.post("/bots", requireAuth, async (req: AuthRequest, res) => {
  const accountId = req.accountId!;
  const { name } = req.body as { name?: string };

  const existingBots = await db.select().from(usersTable).where(eq(usersTable.accountId, accountId));
  if (existingBots.length >= 2) {
    res.status(400).json({ error: "Maximum 2 bots allowed per account" });
    return;
  }

  const botId = uuidv4();
  const sessionId = uuidv4();
  const botName = name?.trim() || `Bot ${existingBots.length + 1}`;
  const [bot] = await db
    .insert(usersTable)
    .values({
      id: botId,
      accountId,
      name: botName,
      sessionId,
      status: "active",
      isFirstConnection: "true",
    })
    .returning();

  await db.insert(userSettingsTable).values({ userId: botId }).onConflictDoNothing();

  res.status(201).json(bot);
});

router.delete("/bots/:botId", requireAuth, async (req: AuthRequest, res) => {
  const { botId } = req.params;
  const accountId = req.accountId!;

  const bot = await getBotForAccount(botId, accountId);
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }

  await deleteBotSession(botId);
  stopPresence(botId);
  await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, botId));
  await db.delete(usersTable).where(eq(usersTable.id, botId));

  res.json({ success: true });
});

router.patch("/bots/:botId/name", requireAuth, async (req: AuthRequest, res) => {
  const { botId } = req.params;
  const accountId = req.accountId!;
  const { name } = req.body as { name: string };

  if (!name?.trim()) {
    res.status(400).json({ error: "Name required" });
    return;
  }

  const bot = await getBotForAccount(botId, accountId);
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({ name: name.trim() })
    .where(eq(usersTable.id, botId))
    .returning();
  res.json(updated);
});

router.post("/bots/:botId/pair", requireAuth, async (req: AuthRequest, res) => {
  const { botId } = req.params;
  const accountId = req.accountId!;
  const { phone } = req.body as { phone: string };

  if (!phone) {
    res.status(400).json({ error: "Phone number required" });
    return;
  }
  const cleanPhone = phone.replace(/[^0-9]/g, "");
  if (cleanPhone.length < 7) {
    res.status(400).json({ error: "Invalid phone number" });
    return;
  }

  const bot = await getBotForAccount(botId, accountId);
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }

  const existing = botInstances.get(botId);
  if (existing?.connected) {
    res.json({ message: "Bot already connected" });
    return;
  }

  try {
    const code = await initiatePairing(botId, cleanPhone);
    await db.update(usersTable).set({ linkedAt: new Date() }).where(eq(usersTable.id, botId));
    res.json({ code });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate pairing code";
    res.status(500).json({ error: message });
  }
});

router.post("/bots/:botId/qr-start", requireAuth, async (req: AuthRequest, res) => {
  const { botId } = req.params;
  const accountId = req.accountId!;

  const bot = await getBotForAccount(botId, accountId);
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }

  const existing = botInstances.get(botId);
  if (existing?.connected) {
    res.json({ message: "Bot already connected" });
    return;
  }

  initiateQR(botId).catch(() => {});
  await db.update(usersTable).set({ linkedAt: new Date() }).where(eq(usersTable.id, botId));
  res.json({ success: true, message: "QR session started" });
});

router.get("/bots/:botId/qr", requireAuth, async (req: AuthRequest, res) => {
  const { botId } = req.params;
  const accountId = req.accountId!;

  const bot = await getBotForAccount(botId, accountId);
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }

  const qr = pendingQRCodes.get(botId) ?? null;
  // Disable caching so the browser never serves a stale 304 response
  // while the frontend is polling for a fresh QR code image.
  res.set("Cache-Control", "no-store").json({ qr, available: !!qr });
});

router.get("/bots/:botId/status", requireAuth, async (req: AuthRequest, res) => {
  const { botId } = req.params;
  const accountId = req.accountId!;

  const bot = await getBotForAccount(botId, accountId);
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }

  const instance = botInstances.get(botId);
  res.json({
    connected: instance?.connected === true,
    status: bot.status,
    phone: bot.phone,
    name: bot.name,
    lastSeen: bot.lastSeen,
  });
});

router.get("/bots/:botId/settings", requireAuth, async (req: AuthRequest, res) => {
  const { botId } = req.params;
  const accountId = req.accountId!;

  const bot = await getBotForAccount(botId, accountId);
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }

  const [settings] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, botId));
  if (!settings) {
    res.status(404).json({ error: "Settings not found" });
    return;
  }
  res.json(settings);
});

router.patch("/bots/:botId/settings", requireAuth, async (req: AuthRequest, res) => {
  const { botId } = req.params;
  const accountId = req.accountId!;

  const bot = await getBotForAccount(botId, accountId);
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }

  const updates = req.body as Record<string, unknown>;
  const allowed = [
    "prefix", "mode", "anticallMsg", "welcomeMsg", "goodbyeMsg", "likeEmojis",
    "anticall", "antilink", "antisticker", "antitag", "antibadword", "antispam",
    "antidelete", "chatbot", "autoread", "alwaysonline", "autoviewstatus",
    "autolikestatus", "autotype", "welcome", "goodbye",
    "antilinkAction", "antistickerAction", "antitagAction", "antibadwordAction", "antispamAction",
    "badwords", "autotypeMode",
  ];

  const filtered: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in updates) filtered[key] = updates[key];
  }

  if (Object.keys(filtered).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [updated] = await db
    .update(userSettingsTable)
    .set(filtered)
    .where(eq(userSettingsTable.userId, botId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Settings not found" });
    return;
  }

  res.json(updated);
});

router.post("/bots/:botId/disconnect", requireAuth, async (req: AuthRequest, res) => {
  const { botId } = req.params;
  const accountId = req.accountId!;

  const bot = await getBotForAccount(botId, accountId);
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }

  await disconnectBotInstance(botId);
  stopPresence(botId);
  await db.update(usersTable).set({ status: "paused", lastSeen: new Date() }).where(eq(usersTable.id, botId));

  res.json({ success: true });
});

export default router;
