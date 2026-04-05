import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  proto,
  WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { v4 as uuidv4 } from "uuid";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { db } from "@workspace/db";
import { usersTable, userSettingsTable, messagesTable } from "@workspace/db";
import { eq, lt } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { handleCommand } from "./commands/index.js";
import { handleProtection } from "./protection.js";
import { handlePresence } from "./presence.js";
import pino from "pino";

const AUTH_DIR = join(process.cwd(), "sessions");

export interface BotInstance {
  socket: WASocket;
  userId: string;
  phone: string;
  paused: boolean;
}

export const botInstances = new Map<string, BotInstance>();
export const pendingPairings = new Map<string, {
  resolve: (code: string) => void;
  reject: (err: Error) => void;
}>();

function getAuthDir(userId: string) {
  const dir = join(AUTH_DIR, userId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function extractInviteCode(urlOrCode: string): string {
  const match = urlOrCode.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
  return match ? match[1] : urlOrCode.split("?")[0];
}

function makeBaileysLogger() {
  return pino({ level: "silent" }) as unknown as ReturnType<typeof pino>;
}

export async function createBotInstance(
  userId: string,
  phone: string,
  isFirstConnection: boolean,
  silentStart = false
): Promise<void> {
  const existing = botInstances.get(userId);
  if (existing && !existing.paused) {
    logger.info({ userId }, "Bot instance already active, skipping");
    return;
  }

  const authDir = getAuthDir(userId);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, makeBaileysLogger()),
    },
    printQRInTerminal: false,
    logger: makeBaileysLogger(),
    browser: ["NUTTER-XMD", "Chrome", "4.0.0"],
    generateHighQualityLinkPreview: true,
    syncFullHistory: false,
  });

  const instance: BotInstance = { socket: sock, userId, phone, paused: false };
  botInstances.set(userId, instance);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const currentInstance = botInstances.get(userId);
      const isPaused = currentInstance?.paused ?? false;

      if (isLoggedOut || isPaused) {
        logger.info({ userId, isLoggedOut, isPaused }, "Bot not reconnecting");
        botInstances.delete(userId);
        if (isLoggedOut) {
          await db.update(usersTable)
            .set({ status: "paused", lastSeen: new Date() })
            .where(eq(usersTable.id, userId));
        }
        return;
      }

      logger.info({ userId }, "Reconnecting bot...");
      setTimeout(() => createBotInstance(userId, phone, false, true), 5000);
    }

    if (connection === "open") {
      logger.info({ userId }, "Bot connected!");

      await db.update(usersTable)
        .set({ status: "active", lastSeen: new Date(), isFirstConnection: "false" })
        .where(eq(usersTable.id, userId));

      if (isFirstConnection && !silentStart) {
        try {
          const jid = `${phone.replace(/[^0-9]/g, "")}@s.whatsapp.net`;
          await sock.sendMessage(jid, {
            text: `✅ *NUTTER-XMD V.9.1.3* connected successfully!\n\nType *.menu* to get started ⚡\n\n_Powered by *NUTTER-XMD* ⚡_`,
          });
          logger.info({ userId }, "Startup message sent");
        } catch (err) {
          logger.error({ err, userId }, "Failed to send startup message");
        }
      }

      handlePresence(sock, userId);

      const autoJoinGroup = process.env.NUTTER_AUTO_JOIN_GROUP;
      const autoJoinChannel = process.env.NUTTER_AUTO_JOIN_CHANNEL;

      if (autoJoinGroup && !silentStart) {
        try { await sock.groupAcceptInvite(extractInviteCode(autoJoinGroup)); } catch (_) {}
      }
      if (autoJoinChannel && !silentStart) {
        try { await sock.newsletterFollow(autoJoinChannel); } catch (_) {}
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message) continue;
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      if (!user || user.status !== "active") continue;
      const [settings] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId));
      if (!settings) continue;

      if (settings.autoread) {
        try { await sock.readMessages([msg.key]); } catch (_) {}
      }

      const isStatus = msg.key.remoteJid === "status@broadcast";

      if (isStatus && settings.autoviewstatus) {
        try {
          await sock.readMessages([msg.key]);
        } catch (_) {}
      }

      if (isStatus && settings.autolikestatus) {
        const emojis = (settings.likeEmojis || "🔥 ✨ 💯 🎉 👍").split(" ").filter(Boolean);
        const emoji = emojis[Math.floor(Math.random() * emojis.length)] ?? "🔥";
        try {
          await sock.sendMessage("status@broadcast", {
            react: { text: emoji, key: msg.key },
          });
        } catch (_) {}
      }

      if (isStatus) continue;

      try {
        await db.insert(messagesTable).values({
          id: uuidv4(),
          userId,
          chatId: msg.key.remoteJid || "",
          messageId: msg.key.id || "",
          content: msg as unknown as Record<string, unknown>,
        });
      } catch (_) {}

      await handleProtection(sock, msg, settings, userId);
      await handleCommand(sock, msg, settings, userId);
    }
  });

  sock.ev.on("messages.delete", async (item) => {
    const [settings] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId));
    if (!settings?.antidelete) return;

    const keys = "keys" in item ? item.keys : [];
    for (const key of keys) {
      if (!key.remoteJid || !key.id) continue;
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const [cached] = await db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.messageId, key.id));

      if (!cached || new Date(cached.createdAt) < tenMinutesAgo) continue;

      const originalMsg = cached.content as proto.IWebMessageInfo;
      if (!originalMsg?.message) continue;

      const senderJid = key.participant || key.remoteJid;
      const chatJid = key.remoteJid;

      try {
        await sock.sendMessage(chatJid, {
          text: `🔄 *Anti-Delete*\n\n*From:* @${senderJid.split("@")[0]}\n*Deleted message recovered:*`,
          mentions: [senderJid],
        });
        await sock.sendMessage(chatJid, { forward: originalMsg });
      } catch (_) {}
    }
  });

  sock.ev.on("call", async (calls) => {
    const [settings] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId));
    if (!settings?.anticall) return;

    for (const call of calls) {
      if (call.status === "offer") {
        try {
          await sock.rejectCall(call.id, call.from);
          const callMsg = settings.anticallMsg || "📵 Calls are not allowed.";
          await sock.sendMessage(call.from, { text: callMsg });
        } catch (_) {}
      }
    }
  });

  sock.ev.on("group-participants.update", async ({ id: groupJid, participants, action }) => {
    const [settings] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId));
    if (!settings) return;

    const groupMeta = await sock.groupMetadata(groupJid).catch(() => null);
    if (!groupMeta) return;

    const botJid = sock.user?.id || "";
    const botParticipant = groupMeta.participants.find(p => p.id === botJid);
    const isBotAdmin = botParticipant?.admin === "admin" || botParticipant?.admin === "superadmin";
    if (!isBotAdmin) return;

    for (const participant of participants) {
      const name = participant.split("@")[0];
      const groupName = groupMeta.subject;

      if (action === "add" && settings.welcome) {
        const welcomeMsg = (settings.welcomeMsg || "👋 Welcome {user} to {group}!")
          .replace("{user}", `@${name}`)
          .replace("{group}", groupName);
        await sock.sendMessage(groupJid, { text: welcomeMsg, mentions: [participant] }).catch(() => {});
      }
      if (action === "remove" && settings.goodbye) {
        const goodbyeMsg = (settings.goodbyeMsg || "👋 Goodbye {user}!")
          .replace("{user}", `@${name}`)
          .replace("{group}", groupName);
        await sock.sendMessage(groupJid, { text: goodbyeMsg, mentions: [participant] }).catch(() => {});
      }
    }
  });
}

export async function initiatePairing(userId: string, phone: string): Promise<string> {
  return new Promise(async (resolve, reject) => {
    const authDir = getAuthDir(userId);
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, makeBaileysLogger()),
      },
      printQRInTerminal: false,
      logger: makeBaileysLogger(),
      browser: ["NUTTER-XMD", "Chrome", "4.0.0"],
      syncFullHistory: false,
    });

    const instance: BotInstance = { socket: sock, userId, phone, paused: false };
    botInstances.set(userId, instance);
    sock.ev.on("creds.update", saveCreds);

    pendingPairings.set(userId, { resolve, reject });

    setTimeout(async () => {
      try {
        const cleanPhone = phone.replace(/[^0-9]/g, "");
        const code = await sock.requestPairingCode(cleanPhone);
        if (code) {
          const pending = pendingPairings.get(userId);
          if (pending) {
            pending.resolve(code);
            pendingPairings.delete(userId);
          }
        }
      } catch (err) {
        const pending = pendingPairings.get(userId);
        if (pending) {
          pending.reject(err as Error);
          pendingPairings.delete(userId);
        }
      }
    }, 2000);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const currentInstance = botInstances.get(userId);
        const isPaused = currentInstance?.paused ?? false;

        if (!isLoggedOut && !isPaused) {
          setTimeout(() => createBotInstance(userId, phone, true, false), 5000);
        }
      }

      if (connection === "open") {
        logger.info({ userId }, "Paired and connected!");

        await db.update(usersTable)
          .set({ status: "active", lastSeen: new Date(), isFirstConnection: "false" })
          .where(eq(usersTable.id, userId));

        const jid = `${phone.replace(/[^0-9]/g, "")}@s.whatsapp.net`;
        try {
          await sock.sendMessage(jid, {
            text: `✅ *NUTTER-XMD V.9.1.3* connected successfully!\n\nType *.menu* to get started ⚡\n\n_Powered by *NUTTER-XMD* ⚡_`,
          });
        } catch (_) {}

        handlePresence(sock, userId);

        const autoJoinGroup = process.env.NUTTER_AUTO_JOIN_GROUP;
        const autoJoinChannel = process.env.NUTTER_AUTO_JOIN_CHANNEL;
        if (autoJoinGroup) {
          try { await sock.groupAcceptInvite(extractInviteCode(autoJoinGroup)); } catch (_) {}
        }
        if (autoJoinChannel) {
          try { await sock.newsletterFollow(autoJoinChannel); } catch (_) {}
        }

        sock.ev.on("messages.upsert", async ({ messages, type }) => {
          if (type !== "notify") return;
          for (const msg of messages) {
            if (!msg.message) continue;
            const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
            if (!user || user.status !== "active") continue;
            const [settings] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId));
            if (!settings) continue;
            if (settings.autoread) {
              try { await sock.readMessages([msg.key]); } catch (_) {}
            }
            const isStatus = msg.key.remoteJid === "status@broadcast";
            if (isStatus && settings.autoviewstatus) {
              try { await sock.readMessages([msg.key]); } catch (_) {}
            }
            if (isStatus && settings.autolikestatus) {
              const emojis = (settings.likeEmojis || "🔥 ✨ 💯 🎉 👍").split(" ").filter(Boolean);
              const emoji = emojis[Math.floor(Math.random() * emojis.length)] ?? "🔥";
              try {
                await sock.sendMessage("status@broadcast", { react: { text: emoji, key: msg.key } });
              } catch (_) {}
            }
            if (isStatus) continue;
            try {
              await db.insert(messagesTable).values({
                id: uuidv4(), userId,
                chatId: msg.key.remoteJid || "",
                messageId: msg.key.id || "",
                content: msg as unknown as Record<string, unknown>,
              });
            } catch (_) {}
            await handleProtection(sock, msg, settings, userId);
            await handleCommand(sock, msg, settings, userId);
          }
        });
      }
    });
  });
}

export async function pauseBotInstance(userId: string): Promise<void> {
  const instance = botInstances.get(userId);
  if (instance) {
    instance.paused = true;
    try {
      await instance.socket.ws.close();
    } catch (_) {}
    botInstances.delete(userId);
  }
}

export async function disconnectBotInstance(userId: string): Promise<void> {
  const instance = botInstances.get(userId);
  if (instance) {
    instance.paused = true;
    try {
      await instance.socket.logout();
    } catch (_) {}
    botInstances.delete(userId);
  }
}

export async function restoreAllSessions(): Promise<void> {
  const users = await db.select().from(usersTable).where(eq(usersTable.status, "active"));
  logger.info({ count: users.length }, "Restoring bot sessions...");
  for (const user of users) {
    if (!user.sessionId) continue;
    const authDir = getAuthDir(user.id);
    if (!existsSync(authDir)) continue;
    logger.info({ userId: user.id, phone: user.phone }, "Restoring session...");
    await createBotInstance(user.id, user.phone, false, true).catch((err) =>
      logger.error({ err, userId: user.id }, "Failed to restore session")
    );
  }
}

export function cleanupExpiredMessages(): void {
  setInterval(async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    try {
      await db.delete(messagesTable).where(lt(messagesTable.createdAt, tenMinutesAgo));
      logger.info("Cleaned up expired messages");
    } catch (err) {
      logger.error({ err }, "Failed to clean messages");
    }
  }, 5 * 60 * 1000);
}
