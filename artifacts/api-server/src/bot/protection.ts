import { WASocket, proto } from "@whiskeysockets/baileys";
import { UserSettings } from "@workspace/db";

function normalizeJid(jid: string): string {
  return jid.replace(/:[\d]+@/, "@");
}

const spamTracker = new Map<string, { count: number; lastTime: number }>();

const GROUP_LINK_REGEX = /chat\.whatsapp\.com\/[A-Za-z0-9]+/gi;

async function applyAction(
  sock: WASocket,
  chatId: string,
  sender: string,
  msgKey: proto.IMessageKey,
  action: string,
  warningText: string
): Promise<void> {
  await sock.sendMessage(chatId, { delete: msgKey }).catch(() => {});
  if (warningText) {
    await sock.sendMessage(chatId, {
      text: `⚠️ @${sender.split("@")[0]} ${warningText}`,
      mentions: [sender],
    }).catch(() => {});
  }
  if (action === "delete_kick") {
    await sock.groupParticipantsUpdate(chatId, [sender], "remove").catch(() => {});
  }
}

export async function handleProtection(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  settings: UserSettings,
  _userId: string
): Promise<void> {
  const chatId = msg.key.remoteJid;
  if (!chatId) return;

  const isGroup = chatId.endsWith("@g.us");
  const sender = msg.key.participant || msg.key.remoteJid || "";
  const messageContent =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption || "";

  if (isGroup) {
    const groupMeta = await sock.groupMetadata(chatId).catch(() => null);
    if (!groupMeta) return;

    const botJid = normalizeJid(sock.user?.id || "");
    const botPart = groupMeta.participants.find(p => normalizeJid(p.id) === botJid);
    const isBotAdmin = botPart?.admin === "admin" || botPart?.admin === "superadmin";
    if (!isBotAdmin) return;

    // Anti-Link: delete (and optionally kick) messages containing any URL
    if (settings.antilink) {
      const urlRegex = /https?:\/\/[^\s]+|www\.[^\s]+/gi;
      if (urlRegex.test(messageContent)) {
        await applyAction(
          sock, chatId, sender, msg.key,
          settings.antilinkAction ?? "delete",
          "Links are not allowed in this group!"
        );
        return;
      }
    }

    // Anti-Sticker: delete (and optionally kick) sticker messages
    if (settings.antisticker && msg.message?.stickerMessage) {
      await applyAction(
        sock, chatId, sender, msg.key,
        settings.antistickerAction ?? "delete",
        "Stickers are not allowed in this group!"
      );
      return;
    }

    // Anti-Tag: block group invite links shared in the group chat
    // (antitag for status updates — mentioning groups in stories — is handled in the status event handler)
    if (settings.antitag) {
      if (GROUP_LINK_REGEX.test(messageContent)) {
        GROUP_LINK_REGEX.lastIndex = 0;
        await applyAction(
          sock, chatId, sender, msg.key,
          settings.antitagAction ?? "delete",
          "Sharing group invite links is not allowed here!"
        );
        return;
      }
      GROUP_LINK_REGEX.lastIndex = 0;
    }

    // Anti-Bad-Word: delete (and optionally kick) messages with banned words
    if (settings.antibadword && settings.badwords) {
      const words = settings.badwords as string[];
      const lower = messageContent.toLowerCase();
      if (words.length > 0 && words.some(w => w && lower.includes(w.toLowerCase()))) {
        await applyAction(
          sock, chatId, sender, msg.key,
          settings.antibadwordAction ?? "delete",
          "That language is not allowed here!"
        );
        return;
      }
    }

    // Anti-Spam: warn and kick if message rate exceeds threshold
    if (settings.antispam) {
      const now = Date.now();
      const key = `${sender}:${chatId}`;
      const tracker = spamTracker.get(key) || { count: 0, lastTime: now };

      if (now - tracker.lastTime < 10000) {
        tracker.count++;
      } else {
        tracker.count = 1;
        tracker.lastTime = now;
      }
      spamTracker.set(key, tracker);

      if (tracker.count >= 5) {
        await sock.sendMessage(chatId, {
          text: `⚠️ @${sender.split("@")[0]} You are sending messages too fast! (${tracker.count} in 10s)`,
          mentions: [sender],
        }).catch(() => {});

        const shouldKick =
          (settings.antispamAction ?? "delete") === "delete_kick" ? tracker.count >= 7 : tracker.count >= 10;

        if (shouldKick) {
          await sock.groupParticipantsUpdate(chatId, [sender], "remove").catch(() => {});
          spamTracker.delete(key);
        }
      }
    }
  }
}
