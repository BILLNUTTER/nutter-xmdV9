import { WASocket, proto } from "@whiskeysockets/baileys";
import { UserSettings, userSettingsTable } from "@workspace/db";
import { db } from "@workspace/db";
import { eq } from "drizzle-orm";

type BooleanSetting = keyof Pick<UserSettings,
  "anticall" | "antilink" | "antisticker" | "antitag" | "antibadword" | "chatbot" |
  "autoread" | "alwaysonline" | "autoviewstatus" | "autolikestatus" | "autotype" |
  "antidelete" | "antispam" | "welcome" | "goodbye"
>;

const TOGGLE_SETTINGS: BooleanSetting[] = [
  "anticall", "antilink", "antisticker", "antitag", "antibadword", "chatbot",
  "autoread", "alwaysonline", "autoviewstatus", "autolikestatus", "autotype",
  "antidelete", "antispam", "welcome", "goodbye",
];

export async function handleSettingsCommand(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  settings: UserSettings,
  userId: string,
  command: string,
  args: string[]
): Promise<void> {
  const chatId = msg.key.remoteJid!;
  const prefix = settings.prefix || ".";

  type SettingUpdate = Partial<typeof userSettingsTable.$inferInsert>;
  async function updateSetting(update: SettingUpdate) {
    await db.update(userSettingsTable)
      .set(update)
      .where(eq(userSettingsTable.userId, userId));
  }

  if (command === "getsettings" || command === "settings") {
    const s = settings;
    const fmt = (v: boolean) => v ? "ON ✅" : "OFF ❌";
    const reply = `╔══[ ⚙️ *BOT SETTINGS* ]══╗

🔑 *Prefix:* ${s.prefix}
🌐 *Mode:* ${s.mode}

*── Protection ──*
${fmt(s.anticall)} Anti Call
${fmt(s.antilink)} Anti Link
${fmt(s.antisticker)} Anti Sticker
${fmt(s.antitag)} Anti Tag
${fmt(s.antibadword)} Anti Bad Word
${fmt(s.antispam)} Anti Spam
${fmt(s.antidelete)} Anti Delete

*── Group ──*
${fmt(s.welcome)} Welcome Message
${fmt(s.goodbye)} Goodbye Message

*── Automation ──*
${fmt(s.chatbot)} Auto Reply
${fmt(s.autoread)} Auto Read

*── Presence ──*
${fmt(s.autotype)} Typing Indicator
${fmt(s.alwaysonline)} Always Online
${fmt(s.autoviewstatus)} Auto View Status
${fmt(s.autolikestatus)} Auto Like Status
❤️ Status Like Emojis: ${s.likeEmojis}

╚══════════════════╝

_Use_ \`${prefix}<setting> on/off\` _to toggle any feature_
_Example:_ \`${prefix}anticall on\`
> *NUTTER-XMD* ⚡`;
    await sock.sendMessage(chatId, { text: reply }, { quoted: msg }).catch(() => {});
    return;
  }

  if (command === "setprefix") {
    if (!args[0]) {
      await sock.sendMessage(chatId, { text: `Usage: ${prefix}setprefix <char>\nExample: ${prefix}setprefix !` }, { quoted: msg }).catch(() => {});
      return;
    }
    const newPrefix = args[0].trim().slice(0, 3);
    await updateSetting({ prefix: newPrefix });
    await sock.sendMessage(chatId, { text: `✅ Prefix changed to: *${newPrefix}*\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
    return;
  }

  if (command === "mode") {
    const mode = args[0]?.toLowerCase();
    if (mode !== "public" && mode !== "private") {
      await sock.sendMessage(chatId, { text: `Usage: ${prefix}mode public/private` }, { quoted: msg }).catch(() => {});
      return;
    }
    await updateSetting({ mode });
    await sock.sendMessage(chatId, { text: `✅ Mode set to: *${mode}*\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
    return;
  }

  if (command === "setwelcome") {
    const text = args.join(" ").trim();
    if (!text) {
      await sock.sendMessage(chatId, {
        text: `Usage: ${prefix}setwelcome <message>\nYou can use {user} and {group} as placeholders.\nExample: ${prefix}setwelcome Welcome {user} to {group}! 🎉`,
      }, { quoted: msg }).catch(() => {});
      return;
    }
    await updateSetting({ welcomeMsg: text });
    await sock.sendMessage(chatId, { text: `✅ Welcome message updated!\n\nPreview:\n${text.replace("{user}", "@Member").replace("{group}", "GroupName")}\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
    return;
  }

  if (command === "setgoodbye") {
    const text = args.join(" ").trim();
    if (!text) {
      await sock.sendMessage(chatId, {
        text: `Usage: ${prefix}setgoodbye <message>\nYou can use {user} and {group} as placeholders.`,
      }, { quoted: msg }).catch(() => {});
      return;
    }
    await updateSetting({ goodbyeMsg: text });
    await sock.sendMessage(chatId, { text: `✅ Goodbye message updated!\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
    return;
  }

  if (command === "setlikeemoji") {
    const emojis = args.join(" ").trim();
    if (!emojis) {
      await sock.sendMessage(chatId, {
        text: `Usage: ${prefix}setlikeemoji <emojis>\nExample: ${prefix}setlikeemoji 🔥 💯 ✨ 🎉\nCurrent: ${settings.likeEmojis}`,
      }, { quoted: msg }).catch(() => {});
      return;
    }
    await updateSetting({ likeEmojis: emojis });
    await sock.sendMessage(chatId, { text: `✅ Like emojis set to: ${emojis}\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
    return;
  }

  if (command === "anticall") {
    const first = args[0]?.toLowerCase();
    if (first === "on" || first === "off") {
      const val = first === "on";
      const customMsg = args.slice(1).join(" ").trim();
      const update: Partial<typeof userSettingsTable.$inferInsert> = { anticall: val };
      if (customMsg) update.anticallMsg = customMsg;
      await updateSetting(update);
      await sock.sendMessage(chatId, {
        text: `✅ Anti-call turned ${val ? "ON ✅" : "OFF ❌"}${customMsg ? `\nMessage: "${customMsg}"` : ""}\n\n_NUTTER-XMD ⚡_`,
      }, { quoted: msg }).catch(() => {});
    } else if (args.length > 0) {
      const customMsg = args.join(" ").trim();
      await updateSetting({ anticallMsg: customMsg });
      await sock.sendMessage(chatId, {
        text: `✅ Anti-call message set to:\n"${customMsg}"\n\n_NUTTER-XMD ⚡_`,
      }, { quoted: msg }).catch(() => {});
    } else {
      await sock.sendMessage(chatId, {
        text: `⚙️ *Anti-Call*\nStatus: ${settings.anticall ? "ON ✅" : "OFF ❌"}\nMessage: ${settings.anticallMsg || "(default)"}\n\nUsage:\n${prefix}anticall on/off\n${prefix}anticall on <custom message>\n${prefix}anticall <custom message>\n\n_NUTTER-XMD ⚡_`,
      }, { quoted: msg }).catch(() => {});
    }
    return;
  }

  const toggleSetting = command as BooleanSetting;
  if (TOGGLE_SETTINGS.includes(toggleSetting)) {
    const action = args[0]?.toLowerCase();
    if (action !== "on" && action !== "off") {
      const current = settings[toggleSetting];
      await sock.sendMessage(chatId, {
        text: `⚙️ *${command}* is currently: ${current ? "ON ✅" : "OFF ❌"}\n\nUsage: ${prefix}${command} on/off\n\n_NUTTER-XMD ⚡_`,
      }, { quoted: msg }).catch(() => {});
      return;
    }
    const value = action === "on";
    const update = Object.fromEntries([[toggleSetting, value]]) as Partial<typeof userSettingsTable.$inferInsert>;
    await updateSetting(update);
    await sock.sendMessage(chatId, {
      text: `✅ *${command.toUpperCase()}* turned ${value ? "ON ✅" : "OFF ❌"}\n\n_NUTTER-XMD ⚡_`,
    }, { quoted: msg }).catch(() => {});
    return;
  }
}
