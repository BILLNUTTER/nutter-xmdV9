import { WASocket, proto } from "@whiskeysockets/baileys";
import { UserSettings, usersTable } from "@workspace/db";
import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { botInstances } from "../manager.js";

export async function handleOwnerCommand(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  settings: UserSettings,
  userId: string,
  command: string,
  args: string[]
): Promise<void> {
  const chatId = msg.key.remoteJid!;
  const sender = msg.key.participant || msg.key.remoteJid || "";
  const prefix = settings.prefix || ".";

  const ownerPhone = sock.user?.id?.split(":")[0] || sock.user?.id?.split("@")[0];
  const senderPhone = sender.split("@")[0];
  const isOwner = senderPhone === ownerPhone || msg.key.fromMe;

  if (!isOwner) {
    await sock.sendMessage(chatId, {
      text: `❌ This command is for the bot owner only!\n\n_NUTTER-XMD ⚡_`,
    }, { quoted: msg }).catch(() => {});
    return;
  }

  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant;
  const targets = mentioned.length > 0 ? mentioned : (quoted ? [quoted] : []);

  switch (command) {
    case "block": {
      for (const t of targets) {
        await sock.updateBlockStatus(t, "block").catch(() => {});
      }
      await sock.sendMessage(chatId, { text: `✅ Blocked ${targets.length} user(s)` }, { quoted: msg }).catch(() => {});
      break;
    }
    case "unblock": {
      for (const t of targets) {
        await sock.updateBlockStatus(t, "unblock").catch(() => {});
      }
      await sock.sendMessage(chatId, { text: `✅ Unblocked ${targets.length} user(s)` }, { quoted: msg }).catch(() => {});
      break;
    }
    case "delete": {
      const stanzaId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
      const participant = msg.message?.extendedTextMessage?.contextInfo?.participant;
      if (!stanzaId) {
        await sock.sendMessage(chatId, {
          text: `Usage: ${prefix}delete (reply to a message to delete it)\n\n_NUTTER-XMD ⚡_`,
        }, { quoted: msg }).catch(() => {});
        break;
      }
      const targetKey: proto.IMessageKey = {
        remoteJid: chatId,
        id: stanzaId,
        fromMe: !participant,
        participant: participant || undefined,
      };
      await sock.sendMessage(chatId, { delete: targetKey }).catch(() => {});
      break;
    }
    case "warn": {
      if (targets.length === 0) {
        await sock.sendMessage(chatId, { text: `Usage: ${prefix}warn @user <reason>` }, { quoted: msg }).catch(() => {});
        return;
      }
      const reason = args.slice(1).join(" ") || "No reason given";
      await sock.sendMessage(chatId, {
        text: `⚠️ *WARNING* ⚠️\n\n@${targets[0].split("@")[0]} has been warned!\n*Reason:* ${reason}\n\n_NUTTER-XMD ⚡_`,
        mentions: targets,
      }, { quoted: msg }).catch(() => {});
      break;
    }
    case "join": {
      const link = args[0]?.replace("https://chat.whatsapp.com/", "");
      if (!link) {
        await sock.sendMessage(chatId, { text: `Usage: ${prefix}join <group link>` }, { quoted: msg }).catch(() => {});
        return;
      }
      await sock.groupAcceptInvite(link).catch(() => {});
      await sock.sendMessage(chatId, { text: `✅ Joined group!` }, { quoted: msg }).catch(() => {});
      break;
    }
    case "leave": {
      if (!chatId.endsWith("@g.us")) {
        await sock.sendMessage(chatId, { text: `❌ I can only leave groups!` }, { quoted: msg }).catch(() => {});
        return;
      }
      await sock.sendMessage(chatId, { text: `👋 Goodbye everyone!\n\n_NUTTER-XMD ⚡_` }).catch(() => {});
      await sock.groupLeave(chatId).catch(() => {});
      break;
    }
    case "online": {
      await sock.sendPresenceUpdate("available").catch(() => {});
      await sock.sendMessage(chatId, { text: `✅ Presence set to online!\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
      break;
    }
    case "setbio": {
      const bio = args.join(" ");
      if (!bio) {
        await sock.sendMessage(chatId, { text: `Usage: ${prefix}setbio <text>` }, { quoted: msg }).catch(() => {});
        return;
      }
      await sock.updateProfileStatus(bio).catch(() => {});
      await sock.sendMessage(chatId, { text: `✅ Bio updated!\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
      break;
    }
    case "restart": {
      await sock.sendMessage(chatId, {
        text: `🔄 Restarting bot...\n\n_NUTTER-XMD ⚡_`,
      }, { quoted: msg }).catch(() => {});
      await db.update(usersTable).set({ lastSeen: new Date() }).where(eq(usersTable.id, userId));
      setTimeout(() => process.exit(0), 2000);
      break;
    }
  }
}
