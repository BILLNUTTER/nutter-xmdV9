import { WASocket, proto, downloadContentFromMessage } from "@whiskeysockets/baileys";
import { UserSettings } from "@workspace/db";
import { randomBytes } from "crypto";
import { botInstances } from "../manager.js";

async function streamToBuffer(stream: AsyncIterable<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const START_TIME = Date.now();

export async function handleToolsCommand(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  settings: UserSettings,
  userId: string,
  command: string,
  args: string[]
): Promise<void> {
  const chatId = msg.key.remoteJid!;
  const prefix = settings.prefix || ".";

  switch (command) {
    case "ping": {
      const start = Date.now();
      await sock.sendMessage(chatId, { text: `🏓 Pong!\n⚡ *${Date.now() - start}ms*\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
      break;
    }
    case "alive": {
      await sock.sendMessage(chatId, {
        text: `✅ *NUTTER-XMD V.9.1.3 is ALIVE!* ⚡\n\n🤖 *Bot:* NUTTER-XMD\n📌 *Version:* V.9.1.3\n⏱️ *Uptime:* ${formatUptime(Date.now() - START_TIME)}\n⚙️ *Prefix:* ${prefix}\n🌐 *Mode:* ${settings.mode}\n\n_Powered by *NUTTER-XMD* ⚡_`,
      }, { quoted: msg }).catch(() => {});
      break;
    }
    case "botstatus": {
      const inst = botInstances.get(userId);
      const status = inst ? "✅ Connected" : "❌ Disconnected";
      await sock.sendMessage(chatId, {
        text: `📊 *BOT STATUS*\n\n${status}\n⏱️ *Uptime:* ${formatUptime(Date.now() - START_TIME)}\n🤖 *Name:* NUTTER-XMD\n📌 *Version:* V.9.1.3\n\n_NUTTER-XMD ⚡_`,
      }, { quoted: msg }).catch(() => {});
      break;
    }
    case "runtime": {
      await sock.sendMessage(chatId, {
        text: `⏱️ *Runtime:* ${formatUptime(Date.now() - START_TIME)}\n\n_NUTTER-XMD ⚡_`,
      }, { quoted: msg }).catch(() => {});
      break;
    }
    case "time": {
      const now = new Date();
      await sock.sendMessage(chatId, {
        text: `🕐 *Current Time*\n\n📅 Date: ${now.toDateString()}\n🕑 Time: ${now.toLocaleTimeString()}\n🌍 Timezone: UTC\n\n_NUTTER-XMD ⚡_`,
      }, { quoted: msg }).catch(() => {});
      break;
    }
    case "calculate": {
      const expr = args.join(" ");
      if (!expr) {
        await sock.sendMessage(chatId, { text: `Usage: ${prefix}calculate <expression>\nExample: ${prefix}calculate 2+2` }, { quoted: msg }).catch(() => {});
        return;
      }
      try {
        const safeExpr = expr.replace(/[^0-9+\-*/().%\s]/g, "");
        const result = Function(`"use strict"; return (${safeExpr})`)();
        await sock.sendMessage(chatId, {
          text: `🔢 *Calculator*\n\n📝 Expression: ${expr}\n✅ Result: *${result}*\n\n_NUTTER-XMD ⚡_`,
        }, { quoted: msg }).catch(() => {});
      } catch {
        await sock.sendMessage(chatId, { text: `❌ Invalid expression!\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
      }
      break;
    }
    case "genpass": {
      const length = parseInt(args[0]) || 16;
      const password = randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);
      await sock.sendMessage(chatId, {
        text: `🔐 *Generated Password*\n\n\`${password}\`\n\n_Save it safely! NUTTER-XMD ⚡_`,
      }, { quoted: msg }).catch(() => {});
      break;
    }
    case "say": {
      const text = args.join(" ");
      if (!text) return;
      await sock.sendMessage(chatId, { text }, { quoted: msg }).catch(() => {});
      break;
    }
    case "fancy": {
      const text = args.join(" ");
      if (!text) {
        await sock.sendMessage(chatId, { text: `Usage: ${prefix}fancy <text>` }, { quoted: msg }).catch(() => {});
        return;
      }
      const fancy = text.split("").map(c => {
        const code = c.charCodeAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(code + 120211);
        if (code >= 97 && code <= 122) return String.fromCodePoint(code + 120205);
        return c;
      }).join("");
      await sock.sendMessage(chatId, { text: fancy }, { quoted: msg }).catch(() => {});
      break;
    }
    case "fliptext": {
      const text = args.join(" ");
      if (!text) {
        await sock.sendMessage(chatId, { text: `Usage: ${prefix}fliptext <text>` }, { quoted: msg }).catch(() => {});
        return;
      }
      await sock.sendMessage(chatId, { text: text.split("").reverse().join("") }, { quoted: msg }).catch(() => {});
      break;
    }
    case "device": {
      const platform = process.platform;
      const arch = process.arch;
      await sock.sendMessage(chatId, {
        text: `💻 *Device Info*\n\nOS: ${platform}\nArch: ${arch}\nNode: ${process.version}\n\n_NUTTER-XMD ⚡_`,
      }, { quoted: msg }).catch(() => {});
      break;
    }
    case "disk": {
      await sock.sendMessage(chatId, {
        text: `💾 *Disk Info*\n\nServer is running on Replit cloud.\n\n_NUTTER-XMD ⚡_`,
      }, { quoted: msg }).catch(() => {});
      break;
    }
    case "repo": {
      await sock.sendMessage(chatId, {
        text: `📦 *NUTTER-XMD Repository*\n\n🤖 *Bot:* NUTTER-XMD\n📌 *Version:* V.9.1.3\n👑 *Creator:* NUTTER-XMD Team\n\n_NUTTER-XMD ⚡_`,
      }, { quoted: msg }).catch(() => {});
      break;
    }
    case "test": {
      await sock.sendMessage(chatId, {
        text: `✅ *Test Successful!*\n\n🤖 NUTTER-XMD is working perfectly!\n⚡ All systems operational.\n\n_NUTTER-XMD ⚡_`,
      }, { quoted: msg }).catch(() => {});
      break;
    }
    case "pair": {
      await sock.sendMessage(chatId, {
        text: `🔗 *Pair NUTTER-XMD*\n\nVisit the dashboard to pair your WhatsApp account.\n\n_NUTTER-XMD ⚡_`,
      }, { quoted: msg }).catch(() => {});
      break;
    }
    case "qrcode": {
      await sock.sendMessage(chatId, {
        text: `📱 *QR Code Generator*\n\n⚠️ This feature requires additional setup.\nUsage: ${prefix}qrcode <text>\n\n_NUTTER-XMD ⚡_`,
      }, { quoted: msg }).catch(() => {});
      break;
    }
    case "tinyurl": {
      await sock.sendMessage(chatId, {
        text: `🔗 *TinyURL*\n\n⚠️ This feature requires an API key.\nUsage: ${prefix}tinyurl <url>\n\n_NUTTER-XMD ⚡_`,
      }, { quoted: msg }).catch(() => {});
      break;
    }
    case "getpp": {
      const target = mentioned(msg)[0] || chatId;
      try {
        const pp = await sock.profilePictureUrl(target, "image");
        if (!pp) throw new Error("No profile picture available");
        await sock.sendMessage(chatId, {
          image: { url: pp },
          caption: `📸 Profile picture of @${target.split("@")[0]}\n\n_NUTTER-XMD ⚡_`,
          mentions: [target],
        }, { quoted: msg });
      } catch {
        await sock.sendMessage(chatId, { text: `❌ No profile picture found.\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
      }
      break;
    }
    case "sticker": {
      await sock.sendMessage(chatId, {
        text: `🎨 *Sticker Creator*\n\nReply to an image with ${prefix}sticker to convert it.\n\n⚠️ This feature requires additional setup.\n\n_NUTTER-XMD ⚡_`,
      }, { quoted: msg }).catch(() => {});
      break;
    }
    case "emojimix": {
      await sock.sendMessage(chatId, {
        text: `😄 *Emoji Mix*\n\nUsage: ${prefix}emojimix <emoji1> <emoji2>\n\n⚠️ This feature requires additional setup.\n\n_NUTTER-XMD ⚡_`,
      }, { quoted: msg }).catch(() => {});
      break;
    }
    case "vv":
    case "vv2": {
      // Look for context info in all possible message wrapper types
      const ctx =
        msg.message?.extendedTextMessage?.contextInfo ??
        msg.message?.imageMessage?.contextInfo ??
        msg.message?.videoMessage?.contextInfo ??
        msg.message?.documentMessage?.contextInfo ??
        msg.message?.audioMessage?.contextInfo ??
        (msg.message as Record<string, { contextInfo?: proto.IContextInfo } | undefined> | undefined)?.['buttonsResponseMessage']?.contextInfo;

      const quotedMsg = ctx?.quotedMessage;
      if (!quotedMsg) {
        await sock.sendMessage(chatId, {
          text: `👁️ *View Once Viewer*\n\nReply to a view-once message with *${prefix}vv* to reveal it.\n\n_NUTTER-XMD ⚡_`,
        }, { quoted: msg }).catch(() => {});
        break;
      }

      // Unwrap viewOnce container — try every known wrapper.
      // Also handle the case where the viewOnce wrapper was already stripped
      // (happens when the message was already opened on the device before reply).
      const vom: proto.IMessage =
        quotedMsg.viewOnceMessage?.message ??
        quotedMsg.viewOnceMessageV2?.message ??
        quotedMsg.viewOnceMessageV2Extension?.message ??
        quotedMsg; // fallback: treat the quoted msg itself as the content

      // Determine media type
      const imgMsg = vom.imageMessage ?? null;
      const vidMsg = vom.videoMessage ?? null;
      const audMsg = vom.audioMessage ?? null;

      if (!imgMsg && !vidMsg && !audMsg) {
        await sock.sendMessage(chatId, {
          text: `❌ No media found in that message. Make sure you are replying to a view-once photo, video, or voice note.\n\n_NUTTER-XMD ⚡_`,
        }, { quoted: msg }).catch(() => {});
        break;
      }

      const botPhone = (sock.user?.id || "").split(":")[0].split("@")[0];
      const dmJid = `${botPhone}@s.whatsapp.net`;
      const senderJid = ctx?.participant ?? ctx?.remoteJid ?? "";
      const senderName = senderJid.split("@")[0] || "someone";

      try {
        if (imgMsg) {
          const stream = await downloadContentFromMessage(imgMsg, "image");
          const buffer = await streamToBuffer(stream as unknown as AsyncIterable<Buffer>);
          await sock.sendMessage(dmJid, {
            image: buffer,
            caption: `👁️ *View Once Revealed*\n\nFrom: @${senderName}\n\n_NUTTER-XMD ⚡_`,
          });
        } else if (vidMsg) {
          const stream = await downloadContentFromMessage(vidMsg, "video");
          const buffer = await streamToBuffer(stream as unknown as AsyncIterable<Buffer>);
          await sock.sendMessage(dmJid, {
            video: buffer,
            caption: `👁️ *View Once Revealed*\n\nFrom: @${senderName}\n\n_NUTTER-XMD ⚡_`,
          });
        } else if (audMsg) {
          const stream = await downloadContentFromMessage(audMsg, "audio");
          const buffer = await streamToBuffer(stream as unknown as AsyncIterable<Buffer>);
          await sock.sendMessage(dmJid, {
            audio: buffer,
            mimetype: "audio/ogg; codecs=opus",
            pttAudio: true,
          });
        }
        await sock.sendMessage(chatId, {
          text: `✅ *View Once Revealed!*\n\nSent to your DM.\n\n_NUTTER-XMD ⚡_`,
        }, { quoted: msg }).catch(() => {});
      } catch (e) {
        await sock.sendMessage(chatId, {
          text: `❌ Failed to reveal: ${(e as Error).message || "Try again"}\n\n_NUTTER-XMD ⚡_`,
        }, { quoted: msg }).catch(() => {});
      }
      break;
    }
    default:
      await sock.sendMessage(chatId, { text: `🛠️ Tool command coming soon!\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
  }
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h ${m % 60}m ${s % 60}s`;
}

function mentioned(msg: proto.IWebMessageInfo): string[] {
  return msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
}
