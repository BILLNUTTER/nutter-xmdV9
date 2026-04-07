import { WASocket, proto } from "@whiskeysockets/baileys";
import { UserSettings } from "@workspace/db";
import { logger } from "../../lib/logger.js";
import { handleMenuCommand } from "./menu.js";
import { handleSettingsCommand } from "./settings.js";
import { handleGroupCommand } from "./group.js";
import { handleOwnerCommand } from "./owner.js";
import { handleToolsCommand } from "./tools.js";
import { handleAICommand } from "./ai.js";
import { handleFunCommand } from "./fun.js";
import { handleSearchCommand } from "./search.js";
import { handleAudioCommand } from "./audio.js";
import { handleDownloadCommand } from "./downloads.js";

export async function handleCommand(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  settings: UserSettings,
  userId: string
): Promise<void> {
  const chatId = msg.key.remoteJid;
  if (!chatId) return;

  // Don't filter fromMe — the bot is the user's own WhatsApp account so all
  // their commands have fromMe=true. Baileys only emits type="notify" for
  // genuinely incoming messages, so the bot's own replies won't loop back.

  const sender = msg.key.participant || msg.key.remoteJid || "";

  const messageText = msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    msg.message?.buttonsResponseMessage?.selectedButtonId ||
    msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId || "";

  const prefix = settings.prefix || ".";
  const isGroup = chatId.endsWith("@g.us");

  if (!messageText.startsWith(prefix)) {
    // Never auto-reply to the bot's own outgoing messages
    if (settings.chatbot && !isGroup && !msg.key.fromMe) {
      await sock.sendMessage(chatId, {
        text: `🤖 Auto-reply is on. Type *${prefix}menu* to see available commands.\n\n_Powered by *NUTTER-XMD* ⚡_`,
      }).catch(() => {});
    }
    return;
  }

  if (settings.mode === "private") {
    const ownerJid = sock.user?.id || "";
    const ownerPhone = ownerJid.split(":")[0].split("@")[0];
    const senderPhone = sender.split("@")[0];
    if (senderPhone !== ownerPhone) {
      return;
    }
  }

  const parts = messageText.slice(prefix.length).trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  logger.info({ command, chatId, sender }, "Command received");

  if (settings.autotype) {
    await sock.sendPresenceUpdate("composing", chatId).catch(() => {});
  }

  try {
    if (command === "menu" || command === "help") {
      await handleMenuCommand(sock, msg, settings, userId);
      return;
    }

    const settingsCommands = [
      "anticall", "antilink", "antisticker", "antitag", "antibadword", "chatbot",
      "autoread", "alwaysonline", "autoviewstatus", "autolikestatus", "autotype",
      "antidelete", "antispam", "welcome", "goodbye", "setlikeemoji", "mode",
      "setprefix", "setwelcome", "setgoodbye", "getsettings", "settings",
    ];
    if (settingsCommands.includes(command)) {
      await handleSettingsCommand(sock, msg, settings, userId, command, args);
      return;
    }

    const groupCommands = [
      "kick", "promote", "demote", "add", "approve", "invite", "open", "close",
      "poll", "tagall", "hidetag", "kickall", "setgroupname", "setdesc",
    ];
    if (groupCommands.includes(command)) {
      await handleGroupCommand(sock, msg, settings, userId, command, args);
      return;
    }

    const ownerCommands = ["block", "unblock", "delete", "warn", "join", "leave", "online", "setbio", "restart"];
    if (ownerCommands.includes(command)) {
      await handleOwnerCommand(sock, msg, settings, userId, command, args);
      return;
    }

    const toolsCommands = [
      "sticker", "emojimix", "qrcode", "tinyurl", "calculate", "genpass", "say",
      "getpp", "fancy", "fliptext", "device", "disk", "ping", "runtime", "time",
      "repo", "botstatus", "vv", "vv2", "test", "alive", "pair",
    ];
    if (toolsCommands.includes(command)) {
      await handleToolsCommand(sock, msg, settings, userId, command, args);
      return;
    }

    const aiCommands = ["gpt", "gemini", "deepseek", "blackbox", "code", "analyze", "summarize", "translate", "recipe", "story", "teach", "generate"];
    if (aiCommands.includes(command)) {
      await handleAICommand(sock, msg, settings, userId, command, args);
      return;
    }

    const funCommands = ["fact", "jokes", "quotes", "trivia", "truth", "dare", "truthordare"];
    if (funCommands.includes(command)) {
      await handleFunCommand(sock, msg, settings, userId, command, args);
      return;
    }

    const searchCommands = ["weather", "define", "imdb", "lyrics", "yts", "shazam"];
    if (searchCommands.includes(command)) {
      await handleSearchCommand(sock, msg, settings, userId, command, args);
      return;
    }

    const audioCommands = ["tomp3", "toptt", "bass", "earrape", "reverse", "robot", "deep"];
    if (audioCommands.includes(command)) {
      await handleAudioCommand(sock, msg, settings, userId, command, args);
      return;
    }

    const downloadCommands = ["youtube", "song", "tiktok", "instagram", "twitter", "facebook", "gdrive", "mediafire", "image"];
    if (downloadCommands.includes(command)) {
      await handleDownloadCommand(sock, msg, settings, userId, command, args);
      return;
    }

    // Unknown command — stay silent (prefix but unrecognised word)
  } catch (err) {
    logger.error({ err, command }, "Command error");
  } finally {
    if (settings.autotype) {
      await sock.sendPresenceUpdate("paused", chatId).catch(() => {});
    }
  }
}
