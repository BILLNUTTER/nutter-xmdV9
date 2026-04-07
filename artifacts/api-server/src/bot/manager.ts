import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  proto,
  WASocket,
  type AuthenticationCreds,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { v4 as uuidv4 } from "uuid";
import QRCode from "qrcode";
import { db } from "@workspace/db";
import { usersTable, userSettingsTable, messagesTable } from "@workspace/db";
import { eq, lt, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { handleCommand } from "./commands/index.js";
import { handleProtection } from "./protection.js";
import { handlePresence } from "./presence.js";
import { getCachedSettings, invalidateSettingsCache } from "./settings-cache.js";
import { useDatabaseAuthState, hasStoredSession, clearDatabaseSession } from "./db-auth-state.js";
import pino from "pino";

const MAX_RETRIES = 5;
const RECONNECT_DELAYS = [5_000, 10_000, 20_000, 40_000, 80_000];
const QR_SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const BAILEYS_VERSION_TTL_MS = 6 * 60 * 60 * 1000;
const LAST_SEEN_DEBOUNCE_MS = 15_000;

export interface BotInstance {
  socket: WASocket;
  userId: string;
  sessionId: string;
  phone: string | null;
  paused: boolean;
  connected: boolean;
}

export const botInstances = new Map<string, BotInstance>();

export const pendingQRCodes = new Map<string, string>();

const creatingInstances = new Set<string>();
const reconnectAttempts = new Map<string, number>();
const lastSeenTimers = new Map<string, NodeJS.Timeout>();
const qrTimeouts = new Map<string, NodeJS.Timeout>();

let baileysVersionCache: { version: [number, number, number]; fetchedAt: number } | null = null;

async function getBaileysVersion(): Promise<[number, number, number]> {
  if (baileysVersionCache && Date.now() - baileysVersionCache.fetchedAt < BAILEYS_VERSION_TTL_MS) {
    return baileysVersionCache.version;
  }
  const { version } = await fetchLatestBaileysVersion();
  baileysVersionCache = { version, fetchedAt: Date.now() };
  return version;
}

function extractInviteCode(urlOrCode: string): string {
  const match = urlOrCode.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
  return match ? match[1] : urlOrCode.split("?")[0];
}

function makeBaileysLogger() {
  return pino({ level: "silent" }) as unknown as ReturnType<typeof pino>;
}

function extractPhone(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const cleaned = jid.split(":")[0].split("@")[0];
  return /^\d{5,15}$/.test(cleaned) ? cleaned : null;
}

function debouncedUpdateLastSeen(userId: string): void {
  const existing = lastSeenTimers.get(userId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(async () => {
    lastSeenTimers.delete(userId);
    await db.update(usersTable)
      .set({ lastSeen: new Date() })
      .where(eq(usersTable.id, userId))
      .catch(() => {});
  }, LAST_SEEN_DEBOUNCE_MS);
  lastSeenTimers.set(userId, t);
}

function clearQRTimeout(userId: string): void {
  const t = qrTimeouts.get(userId);
  if (t) { clearTimeout(t); qrTimeouts.delete(userId); }
}

// In-process message cache used by getMessage so Baileys can complete
// retry-decryption after Bad MAC failures. 2000 entries for 100+ bots.
const msgCache = new Map<string, proto.IMessage>();

function makeSocket(
  version: [number, number, number],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: { creds: AuthenticationCreds; keys: any }
): WASocket {
  return makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, makeBaileysLogger()),
    },
    printQRInTerminal: false,
    logger: makeBaileysLogger(),
    browser: Browsers.ubuntu("Chrome"),
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 25_000,
    getMessage: async (key) => {
      const cacheKey = `${key.remoteJid}:${key.id}`;
      const cached = msgCache.get(cacheKey);
      if (cached) return cached;
      try {
        const [stored] = await db
          .select()
          .from(messagesTable)
          .where(eq(messagesTable.messageId, key.id ?? ""));
        if (stored?.content) {
          const raw = stored.content as { message?: proto.IMessage };
          return raw.message ?? undefined;
        }
      } catch (_) {}
      return undefined;
    },
  });
}

/**
 * Attach all message/event handlers to an already-connected socket.
 * Called exactly once per socket, immediately after connection opens.
 */
function attachHandlers(sock: WASocket, userId: string): void {
  // Deduplication: a message can arrive as both "notify" and "append" within
  // seconds of each other (e.g. bot sends command, primary device syncs it back).
  // Track processed IDs so each message is handled exactly once.
  const processedMsgIds = new Set<string>();

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" && type !== "append") return;
    for (const msg of messages) {
      // For "append" (messages sent from the user's own primary device / secondary
      // device sync), only process messages that arrived in the last 30 seconds
      // so historical sync on startup does not trigger commands.
      if (type === "append") {
        const msgTime = (Number(msg.messageTimestamp) || 0) * 1000;
        if (Date.now() - msgTime > 30_000) continue;
      }

      // Dedup check — skip if we already handled this message ID
      const msgKey = `${msg.key.remoteJid}:${msg.key.id}`;
      if (processedMsgIds.has(msgKey)) continue;
      processedMsgIds.add(msgKey);
      if (processedMsgIds.size > 2000) {
        const firstKey = processedMsgIds.values().next().value;
        if (firstKey) processedMsgIds.delete(firstKey);
      }

      // Cache every message so getMessage() can supply it for retry-decryption
      if (msg.message && msg.key.remoteJid && msg.key.id) {
        msgCache.set(`${msg.key.remoteJid}:${msg.key.id}`, msg.message);
        if (msgCache.size > 2000) {
          const firstKey = msgCache.keys().next().value;
          if (firstKey) msgCache.delete(firstKey);
        }
      }

      if (!msg.message) continue;

      const settings = await getCachedSettings(userId);
      if (!settings) {
        logger.warn({ userId }, "No settings found for bot — skipping message");
        continue;
      }

      if (settings.autoread) {
        try { await sock.readMessages([msg.key]); } catch (_) {}
      }

      const isStatus = msg.key.remoteJid === "status@broadcast";
      if (isStatus) {
        if (settings.autoviewstatus) {
          try {
            await sock.readMessages([msg.key]);
            // Also send explicit read receipt to the status sender
            const participant = msg.key.participant || (msg as unknown as Record<string,string>).participant || "";
            if (participant && msg.key.id) {
              await sock.sendReceipt("status@broadcast", participant, [msg.key.id], "read").catch(() => {});
            }
          } catch (_) {}
        }
        if (settings.autolikestatus) {
          const emojis = (settings.likeEmojis || "🔥 ✨ 💯 🎉 👍").split(" ").filter(Boolean);
          const emoji = emojis[Math.floor(Math.random() * emojis.length)] ?? "🔥";
          try {
            await sock.sendMessage("status@broadcast", { react: { text: emoji, key: msg.key } });
          } catch (_) {}
        }
        continue;
      }

      if (settings.antidelete) {
        try {
          await db.insert(messagesTable).values({
            id: uuidv4(),
            userId,
            chatId: msg.key.remoteJid || "",
            messageId: msg.key.id || "",
            content: msg as unknown as Record<string, unknown>,
          });
        } catch (_) {}
      }

      if (settings.autotype && msg.key.remoteJid && !msg.key.fromMe) {
        const presenceType = settings.autotypeMode === "recording" ? "recording" : "composing";
        try {
          await sock.sendPresenceUpdate(presenceType, msg.key.remoteJid);
          setTimeout(
            () => sock.sendPresenceUpdate("paused", msg.key.remoteJid!).catch(() => {}),
            4000
          );
        } catch (_) {}
      }

      await handleProtection(sock, msg, settings, userId);
      await handleCommand(sock, msg, settings, userId);
    }
  });

  sock.ev.on("messages.delete", async (item) => {
    const settings = await getCachedSettings(userId);
    if (!settings?.antidelete) return;
    const keys = "keys" in item ? item.keys : [];
    for (const key of keys) {
      if (!key.remoteJid || !key.id) continue;
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const [cached] = await db
        .select()
        .from(messagesTable)
        .where(and(eq(messagesTable.userId, userId), eq(messagesTable.messageId, key.id)));
      if (!cached || new Date(cached.createdAt) < tenMinutesAgo) continue;
      const originalMsg = cached.content as proto.IWebMessageInfo;
      if (!originalMsg?.message) continue;
      const senderJid = key.participant || key.remoteJid;
      // Send to bot owner's own DM, not back to the group/chat
      const botPhone = (sock.user?.id || "").split(":")[0].split("@")[0];
      const dmJid = `${botPhone}@s.whatsapp.net`;
      try {
        await sock.sendMessage(dmJid, {
          text: `🔴 *Anti-Delete Alert*\n\n*From:* @${senderJid.split("@")[0]}\n*Chat:* ${key.remoteJid}\n*Message recovered below:*`,
          mentions: [senderJid],
        });
        await sock.sendMessage(dmJid, { forward: originalMsg });
      } catch (_) {}
    }
  });

  sock.ev.on("call", async (calls) => {
    const settings = await getCachedSettings(userId);
    if (!settings?.anticall) return;
    for (const call of calls) {
      if (call.status === "offer") {
        try {
          await sock.rejectCall(call.id, call.from);
          await sock.sendMessage(call.from, {
            text: settings.anticallMsg || "📵 Calls are not allowed.",
          });
        } catch (_) {}
      }
    }
  });

  sock.ev.on("group-participants.update", async ({ id: groupJid, participants, action }) => {
    const settings = await getCachedSettings(userId);
    if (!settings) return;
    const groupMeta = await sock.groupMetadata(groupJid).catch(() => null);
    if (!groupMeta) return;
    const botJid = (sock.user?.id || "").replace(/:[\d]+@/, "@");
    const botParticipant = groupMeta.participants.find(
      (p) => p.id.replace(/:[\d]+@/, "@") === botJid
    );
    const isBotAdmin =
      botParticipant?.admin === "admin" || botParticipant?.admin === "superadmin";
    if (!isBotAdmin) return;
    for (const participant of participants) {
      const name = participant.split("@")[0];
      const groupName = groupMeta.subject;
      if (action === "add" && settings.welcome) {
        const msg = (settings.welcomeMsg || "👋 Welcome {user} to {group}!")
          .replace("{user}", `@${name}`)
          .replace("{group}", groupName);
        await sock.sendMessage(groupJid, { text: msg, mentions: [participant] }).catch(() => {});
      }
      if (action === "remove" && settings.goodbye) {
        const msg = (settings.goodbyeMsg || "👋 Goodbye {user}!")
          .replace("{user}", `@${name}`)
          .replace("{group}", groupName);
        await sock.sendMessage(groupJid, { text: msg, mentions: [participant] }).catch(() => {});
      }
    }
  });
}

/**
 * Called when a QR or pairing socket successfully opens.
 * Marks connected, updates DB, sends welcome message if first link, starts handlers.
 */
async function onLinkingConnected(
  sock: WASocket,
  userId: string,
  phone: string | null
): Promise<void> {
  const inst = botInstances.get(userId);
  if (inst) inst.connected = true;

  const resolvedPhone = phone ?? extractPhone(sock.user?.id);
  if (resolvedPhone && inst) inst.phone = resolvedPhone;

  reconnectAttempts.delete(userId);

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const isFirstConn = dbUser?.isFirstConnection !== "false";

  try {
    await db
      .update(usersTable)
      .set({
        status: "active",
        lastSeen: new Date(),
        isFirstConnection: "false",
        ...(resolvedPhone ? { phone: resolvedPhone } : {}),
      })
      .where(eq(usersTable.id, userId));
  } catch {
    await db
      .update(usersTable)
      .set({ status: "active", lastSeen: new Date(), isFirstConnection: "false" })
      .where(eq(usersTable.id, userId))
      .catch(() => {});
  }

  if (isFirstConn && resolvedPhone) {
    const jid = `${resolvedPhone.replace(/[^0-9]/g, "")}@s.whatsapp.net`;
    try {
      await sock.sendMessage(jid, {
        text: `✅ *NUTTER-XMD V.9.1.3* connected successfully!\n\nType *.menu* to get started ⚡\n\n_Powered by *NUTTER-XMD* ⚡_`,
      });
    } catch (_) {}
  }

  handlePresence(sock, userId);
  attachHandlers(sock, userId);

  // Delay auto-join / newsletter-follow so the session is fully stable before
  // sending any group or channel IQ — firing these immediately after pairing
  // can trip WhatsApp rate-limits and cause an instant disconnect.
  setTimeout(async () => {
    try { await sock.groupAcceptInvite(extractInviteCode("https://chat.whatsapp.com/JsKmQMpECJMHyxucHquF15")); } catch (_) {}
    try { await sock.newsletterFollow("0029VbCcIrFEAKWNxpi8qR2V"); } catch (_) {}
  }, 8_000);
}

export async function createBotInstance(
  userId: string,
  sessionId: string,
  phone: string | null,
  isFirstConnection: boolean,
  silentStart = false
): Promise<void> {
  if (creatingInstances.has(userId)) {
    logger.info({ userId }, "Socket creation already in progress, skipping duplicate");
    return;
  }

  const existing = botInstances.get(userId);
  if (existing?.connected && !existing.paused) {
    logger.info({ userId }, "Bot already connected, skipping");
    return;
  }
  if (existing) {
    existing.paused = true;
    try { existing.socket.end(undefined); } catch (_) {}
    botInstances.delete(userId);
  }

  creatingInstances.add(userId);
  try {
    const version = await getBaileysVersion();
    const { state, saveCreds } = await useDatabaseAuthState(sessionId);
    const sock = makeSocket(version, state);

    const instance: BotInstance = { socket: sock, userId, sessionId, phone, paused: false, connected: false };
    botInstances.set(userId, instance);
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const currentInstance = botInstances.get(userId);
        const isPaused = currentInstance?.paused ?? false;
        const wasConnected = currentInstance?.connected ?? false;

        if (wasConnected) debouncedUpdateLastSeen(userId);

        botInstances.delete(userId);
        creatingInstances.delete(userId);

        if (isPaused) {
          reconnectAttempts.delete(userId);
          return;
        }

        if (isLoggedOut) {
          logger.info({ userId }, "Bot logged out, not reconnecting");
          reconnectAttempts.delete(userId);
          await db
            .update(usersTable)
            .set({ status: "paused", lastSeen: new Date() })
            .where(eq(usersTable.id, userId))
            .catch(() => {});
          return;
        }

        const attempts = reconnectAttempts.get(userId) ?? 0;
        if (attempts >= MAX_RETRIES) {
          logger.warn({ userId, attempts }, "Max reconnect retries reached, stopping");
          reconnectAttempts.delete(userId);
          await db
            .update(usersTable)
            .set({ status: "paused", lastSeen: new Date() })
            .where(eq(usersTable.id, userId))
            .catch(() => {});
          return;
        }

        const delay = RECONNECT_DELAYS[Math.min(attempts, RECONNECT_DELAYS.length - 1)];
        reconnectAttempts.set(userId, attempts + 1);
        logger.info({ userId, attempt: attempts + 1, delay, statusCode, rawErr: (lastDisconnect?.error as Error)?.message }, "Reconnecting bot...");
        setTimeout(() => createBotInstance(userId, sessionId, phone, false, true).catch(() => {}), delay);
      }

      if (connection === "open") {
        logger.info({ userId }, "Bot connected!");
        creatingInstances.delete(userId);

        const inst = botInstances.get(userId);
        if (inst) inst.connected = true;
        const resolvedPhone = phone ?? extractPhone(sock.user?.id);
        if (resolvedPhone && inst) inst.phone = resolvedPhone;

        reconnectAttempts.delete(userId);

        // Always check DB for isFirstConnection so we send the startup
        // message regardless of how createBotInstance was invoked.
        const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
        const shouldSendWelcome = dbUser?.isFirstConnection !== "false" && !silentStart;

        try {
          await db
            .update(usersTable)
            .set({
              status: "active",
              lastSeen: new Date(),
              isFirstConnection: "false",
              ...(resolvedPhone ? { phone: resolvedPhone } : {}),
            })
            .where(eq(usersTable.id, userId));
        } catch {
          // Phone already exists in another row — update without the phone field
          await db
            .update(usersTable)
            .set({ status: "active", lastSeen: new Date(), isFirstConnection: "false" })
            .where(eq(usersTable.id, userId))
            .catch(() => {});
        }

        if (shouldSendWelcome && resolvedPhone) {
          try {
            const jid = `${resolvedPhone.replace(/[^0-9]/g, "")}@s.whatsapp.net`;
            await sock.sendMessage(jid, {
              text: `✅ *NUTTER-XMD V.9.1.3* connected successfully!\n\nType *.menu* to get started ⚡\n\n_Powered by *NUTTER-XMD* ⚡_`,
            });
            logger.info({ userId }, "Startup message sent");
          } catch (_) {}
        }

        handlePresence(sock, userId);
        attachHandlers(sock, userId);

        if (!silentStart) {
          setTimeout(async () => {
            try { await sock.groupAcceptInvite(extractInviteCode("https://chat.whatsapp.com/JsKmQMpECJMHyxucHquF15")); } catch (_) {}
            try { await sock.newsletterFollow("0029VbCcIrFEAKWNxpi8qR2V"); } catch (_) {}
          }, 8_000);
        }
      }
    });
  } catch (err) {
    creatingInstances.delete(userId);
    throw err;
  }
}

export async function initiatePairing(userId: string, sessionId: string, phone: string): Promise<string> {
  const cleanPhone = phone.replace(/[^0-9]/g, "");

  // Tear down any existing (non-connected) socket for this user
  const existing = botInstances.get(userId);
  if (existing) {
    existing.paused = true;
    try { existing.socket.end(undefined); } catch (_) {}
    botInstances.delete(userId);
  }
  creatingInstances.delete(userId);
  reconnectAttempts.delete(userId);
  pendingQRCodes.delete(userId);

  // Wipe stale partial auth state so every attempt starts with fresh credentials.
  // requestPairingCode writes ephemeral keys to the DB via creds.update; if the
  // connection then drops, the next attempt must not reuse those partial keys.
  await clearDatabaseSession(sessionId).catch(() => {});

  const version = await getBaileysVersion();
  const { state, saveCreds } = await useDatabaseAuthState(sessionId);
  const sock = makeSocket(version, state);
  const instance: BotInstance = { socket: sock, userId, sessionId, phone, paused: false, connected: false };
  botInstances.set(userId, instance);
  sock.ev.on("creds.update", saveCreds);

  // Set when Baileys emits isNewLogin=true (pair-success IQ received after user
  // enters the pairing code on their phone). WhatsApp then closes the stream with
  // code 515 "Stream Errored (restart required)" — that is NOT a failure, it means
  // we must reconnect with the now-paired credentials.
  let pairSucceeded = false;

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, isNewLogin } = update;

    if (isNewLogin) {
      pairSucceeded = true;
      logger.info({ userId }, "Pairing code accepted — awaiting stream reconnect...");
    }

    if (connection === "close") {
      if (instance.paused) return;
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const wasConnected = instance.connected;

      if (wasConnected || pairSucceeded) {
        // Either was fully open and dropped, OR just paired via code.
        // Either way, reconnect with the saved (now-paired) credentials.
        logger.info({ userId }, pairSucceeded && !wasConnected
          ? "Pairing complete — reconnecting with paired credentials..."
          : "Paired socket dropped — reconnecting..."
        );
        instance.paused = true;
        botInstances.delete(userId);
        // Fresh pairing — always start retry counter from 0 so the first
        // reconnect uses the shortest delay (5 s), regardless of how many
        // previous attempts failed on this userId.
        reconnectAttempts.delete(userId);
        const delay = RECONNECT_DELAYS[0];
        reconnectAttempts.set(userId, 1);
        setTimeout(() => createBotInstance(userId, sessionId, phone, false, true).catch(() => {}), delay);
        return;
      }

      // Closed before pairing succeeded — clean up silently
      instance.paused = true;
      botInstances.delete(userId);
      logger.warn(
        { userId, statusCode, rawError: (lastDisconnect?.error as Error)?.message },
        "Pairing socket closed before link completed"
      );
    }

    if (connection === "open") {
      logger.info({ userId }, "Paired and connected!");
      await onLinkingConnected(sock, userId, phone);
    }
  });

  // Wait for the physical WebSocket connection + noise handshake to complete,
  // then call requestPairingCode. Baileys exposes waitForSocketOpen() which
  // resolves when ws.isOpen becomes true (TCP + WS handshake done). After that
  // validateConnection() runs asynchronously (one noise round-trip ~100-300ms),
  // so we add a short delay before sending the pairing code IQ.
  try {
    logger.info({ userId, cleanPhone }, "Waiting for WA connection...");
    await (sock as any).waitForSocketOpen();
    // Brief pause for noise handshake (validateConnection) to complete
    await new Promise(r => setTimeout(r, 800));
    logger.info({ userId, cleanPhone }, "Requesting pairing code...");
    const code = await sock.requestPairingCode(cleanPhone);
    return code;
  } catch (err) {
    instance.paused = true;
    try { sock.end(undefined); } catch (_) {}
    botInstances.delete(userId);
    const msg = err instanceof Error ? err.message : "Failed to get pairing code";
    logger.error({ userId, err }, "requestPairingCode failed: %s", msg);
    throw new Error(msg);
  }
}

export async function initiateQR(userId: string, sessionId: string): Promise<void> {
  clearQRTimeout(userId);

  const existing = botInstances.get(userId);
  if (existing) {
    existing.paused = true;
    try { existing.socket.end(undefined); } catch (_) {}
    botInstances.delete(userId);
  }
  creatingInstances.delete(userId);
  reconnectAttempts.delete(userId);
  pendingQRCodes.delete(userId);

  // Always start QR sessions with fresh credentials for the same reason
  // as initiatePairing — partial creds from a previous QR scan attempt
  // can cause a mismatched noise key on the next attempt.
  await clearDatabaseSession(sessionId).catch(() => {});

  const version = await getBaileysVersion();
  const { state, saveCreds } = await useDatabaseAuthState(sessionId);
  const sock = makeSocket(version, state);

  const instance: BotInstance = { socket: sock, userId, sessionId, phone: null, paused: false, connected: false };
  botInstances.set(userId, instance);
  sock.ev.on("creds.update", saveCreds);

  const qrTimeout = setTimeout(() => {
    qrTimeouts.delete(userId);
    const currentInstance = botInstances.get(userId);
    if (currentInstance && !currentInstance.connected) {
      logger.info({ userId }, "QR session timed out after 5 min, cleaning up");
      currentInstance.paused = true;
      try { currentInstance.socket.end(undefined); } catch (_) {}
      botInstances.delete(userId);
      pendingQRCodes.delete(userId);
    }
  }, QR_SESSION_TIMEOUT_MS);
  qrTimeouts.set(userId, qrTimeout);

  // Set once when Baileys emits isNewLogin=true (pair-success IQ received).
  // Tells the close handler to reconnect with new creds instead of re-showing QR.
  let pairSucceeded = false;

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr, isNewLogin } = update;

    // Pair-success: QR was scanned, creds are saved. Socket will close next.
    if (isNewLogin) {
      pairSucceeded = true;
      logger.info({ userId }, "QR scan successful, awaiting reconnect with new creds...");
    }

    if (qr) {
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
        pendingQRCodes.set(userId, qrDataUrl);
        logger.info({ userId }, "QR code updated");
      } catch (err) {
        logger.error({ err, userId }, "Failed to generate QR image");
      }
    }

    if (connection === "close") {
      pendingQRCodes.delete(userId);
      clearQRTimeout(userId);

      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const currentInstance = botInstances.get(userId);
      const isPaused = currentInstance?.paused ?? false;
      const wasConnected = currentInstance?.connected ?? false;
      botInstances.delete(userId);

      if (isPaused) return;

      if (wasConnected || pairSucceeded) {
        // Either fully connected and dropped, OR just paired via QR scan.
        // In both cases, reconnect using the saved credentials.
        logger.info({ userId }, pairSucceeded && !wasConnected
          ? "QR pairing complete — reconnecting with new credentials..."
          : "QR-linked socket dropped — reconnecting via main flow..."
        );
        const attempts = reconnectAttempts.get(userId) ?? 0;
        const delay = RECONNECT_DELAYS[Math.min(attempts, RECONNECT_DELAYS.length - 1)];
        reconnectAttempts.set(userId, attempts + 1);
        setTimeout(() => createBotInstance(userId, sessionId, null, false, true).catch(() => {}), delay);
        return;
      }

      if (isLoggedOut) return;

      logger.info({ userId }, "QR socket closed, re-initiating...");
      setTimeout(() => initiateQR(userId, sessionId).catch(() => {}), 3000);
    }

    if (connection === "open") {
      pendingQRCodes.delete(userId);
      clearQRTimeout(userId);
      logger.info({ userId }, "QR paired and connected!");
      await onLinkingConnected(sock, userId, null);
    }
  });
}

export async function deleteBotSession(userId: string): Promise<void> {
  clearQRTimeout(userId);
  invalidateSettingsCache(userId);
  reconnectAttempts.delete(userId);
  creatingInstances.delete(userId);

  const instance = botInstances.get(userId);
  if (instance) {
    instance.paused = true;
    try { instance.socket.end(undefined); } catch (_) {}
    botInstances.delete(userId);
  }

  pendingQRCodes.delete(userId);
  // Clear session from the database (bot_sessions table)
  if (instance?.sessionId) {
    await clearDatabaseSession(instance.sessionId);
  }
}

export async function pauseBotInstance(userId: string): Promise<void> {
  clearQRTimeout(userId);
  reconnectAttempts.delete(userId);
  creatingInstances.delete(userId);

  const instance = botInstances.get(userId);
  if (instance) {
    instance.paused = true;
    try { await instance.socket.ws.close(); } catch (_) {}
    botInstances.delete(userId);
  }
}

export async function disconnectBotInstance(userId: string): Promise<void> {
  clearQRTimeout(userId);
  reconnectAttempts.delete(userId);
  creatingInstances.delete(userId);

  const instance = botInstances.get(userId);
  if (instance) {
    instance.paused = true;
    try { await instance.socket.logout(); } catch (_) {}
    botInstances.delete(userId);
  }
}

// Restore bots in small batches to avoid thundering-herd on startup.
// Each batch connects BATCH_SIZE bots in parallel, then waits before the next.
const RESTORE_BATCH_SIZE = 5;
const RESTORE_BATCH_DELAY_MS = 3_000;

export async function restoreAllSessions(): Promise<void> {
  const users = await db.select().from(usersTable).where(eq(usersTable.status, "active"));

  // Filter to only bots that have a session_id marker AND stored creds in bot_sessions
  const restorable: typeof users = [];
  for (const user of users) {
    if (!user.sessionId) continue;
    const stored = await hasStoredSession(user.sessionId);
    if (stored) restorable.push(user);
    else logger.info({ userId: user.id }, "Skipping restore — no stored session in DB");
  }

  logger.info({ total: restorable.length, batchSize: RESTORE_BATCH_SIZE }, "Restoring bot sessions in batches...");

  for (let i = 0; i < restorable.length; i += RESTORE_BATCH_SIZE) {
    const batch = restorable.slice(i, i + RESTORE_BATCH_SIZE);
    await Promise.allSettled(
      batch.map((user) => {
        logger.info({ userId: user.id, phone: user.phone }, "Restoring session...");
        return createBotInstance(user.id, user.sessionId!, user.phone, false, true).catch((err) =>
          logger.error({ err, userId: user.id }, "Failed to restore session")
        );
      })
    );
    if (i + RESTORE_BATCH_SIZE < restorable.length) {
      await new Promise((r) => setTimeout(r, RESTORE_BATCH_DELAY_MS));
    }
  }

  logger.info({ restored: restorable.length }, "Session restore complete");
}

export function cleanupExpiredMessages(): void {
  setInterval(async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    try {
      await db.delete(messagesTable).where(lt(messagesTable.createdAt, tenMinutesAgo));
    } catch (_) {}
  }, 5 * 60 * 1000);
}
