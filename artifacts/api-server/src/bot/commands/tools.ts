import { WASocket, proto, downloadContentFromMessage, downloadMediaMessage } from "@whiskeysockets/baileys";
import { UserSettings } from "@workspace/db";
import { randomBytes, randomUUID } from "crypto";
import { botInstances } from "../manager.js";
import { getViewOnce } from "../msg-store.js";
import { execFile, execSync } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, access } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const execFileAsync = promisify(execFile);

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

const FFMPEG_BIN: Promise<string> = (async () => {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const p = execSync("which ffmpeg 2>/dev/null", { encoding: "utf8", stdio: ["pipe","pipe","pipe"] }).trim();
    if (p) return p;
  } catch {}
  const candidates = [
    "/nix/store/s41bqqrym7dlk8m3nk74fx26kgrx0kv8-replit-runtime-path/bin/ffmpeg",
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
  ];
  for (const c of candidates) {
    if (await fileExists(c)) return c;
  }
  return "ffmpeg";
})();

async function streamToBuffer(stream: AsyncIterable<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function downloadQuotedImage(
  sock: WASocket,
  msg: proto.IWebMessageInfo
): Promise<Buffer | null> {
  const ctx =
    msg.message?.extendedTextMessage?.contextInfo ??
    msg.message?.imageMessage?.contextInfo;

  if (!ctx?.quotedMessage || !ctx.stanzaId) return null;
  const qm = ctx.quotedMessage;
  if (!qm.imageMessage) return null;

  const fakeMsg: proto.IWebMessageInfo = {
    key: {
      remoteJid: msg.key.remoteJid,
      fromMe: ctx.participant === (sock as any).user?.id,
      id: ctx.stanzaId,
      participant: ctx.participant ?? undefined,
    },
    message: qm,
  };

  try {
    return await downloadMediaMessage(
      fakeMsg,
      "buffer",
      {},
      { logger: undefined as any, reuploadRequest: sock.updateMediaMessage }
    ) as Buffer;
  } catch {
    return null;
  }
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
        text: `✅ *NUTTER-XMD V.9.1.3 is ALIVE!* ⚡\n\n🇰🇪 *Bot:* NUTTER-XMD\n📌 *Version:* V.9.1.3\n⏱️ *Uptime:* ${formatUptime(Date.now() - START_TIME)}\n⚙️ *Prefix:* ${prefix}\n🌐 *Mode:* ${settings.mode}\n\n_Powered by *NUTTER-XMD* ⚡_`,
      }, { quoted: msg }).catch(() => {});
      break;
    }
    case "botstatus": {
      const inst = botInstances.get(userId);
      const status = inst ? "✅ Connected" : "❌ Disconnected";
      await sock.sendMessage(chatId, {
        text: `📊 *BOT STATUS*\n\n${status}\n⏱️ *Uptime:* ${formatUptime(Date.now() - START_TIME)}\n🇰🇪 *Name:* NUTTER-XMD\n📌 *Version:* V.9.1.3\n\n_NUTTER-XMD ⚡_`,
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
      if (!text) {
        await sock.sendMessage(chatId, { text: `Usage: ${prefix}say <text>\n\nExample: ${prefix}say Hello world\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
        return;
      }
      try {
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=en&client=tw-ob&ttsspeed=1`;
        const resp = await fetch(ttsUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; NUTTER-XMD)" } });
        if (!resp.ok) throw new Error(`TTS fetch failed: ${resp.status}`);
        const mp3 = Buffer.from(await resp.arrayBuffer());

        const id = randomUUID();
        const inPath  = join(tmpdir(), `say_in_${id}.mp3`);
        const outPath = join(tmpdir(), `say_out_${id}.ogg`);
        await writeFile(inPath, mp3);
        const bin = await FFMPEG_BIN;
        try {
          await execFileAsync(bin, [
            "-y", "-i", inPath,
            "-c:a", "libopus", "-b:a", "64k",
            "-ar", "48000", "-ac", "1",
            outPath,
          ]);
        } finally {
          await unlink(inPath).catch(() => {});
        }
        const ogg = await readFile(outPath);
        await unlink(outPath).catch(() => {});

        await sock.sendMessage(chatId, {
          audio: ogg,
          mimetype: "audio/ogg; codecs=opus",
          ptt: true,
        }, { quoted: msg });
      } catch {
        await sock.sendMessage(chatId, { text: `❌ TTS failed. Please try again.\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
      }
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
        text: `📦 *NUTTER-XMD Repository*\n\n🇰🇪 *Bot:* NUTTER-XMD\n📌 *Version:* V.9.1.3\n👑 *Creator:* NUTTER-XMD Team\n\n_NUTTER-XMD ⚡_`,
      }, { quoted: msg }).catch(() => {});
      break;
    }
    case "test": {
      await sock.sendMessage(chatId, {
        text: `✅ *Test Successful!*\n\n🇰🇪 NUTTER-XMD is working perfectly!\n⚡ All systems operational.\n\n_NUTTER-XMD ⚡_`,
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
      // Support .sticker when the command message itself IS an image, or when it replies to an image
      let imgBuf: Buffer | null = null;

      if (msg.message?.imageMessage) {
        // User sent a photo with ".sticker" as the caption
        try {
          const stream = await downloadContentFromMessage(msg.message.imageMessage, "image");
          imgBuf = await streamToBuffer(stream as AsyncIterable<Buffer>);
        } catch { imgBuf = null; }
      }

      if (!imgBuf) {
        // Try quoted/replied image
        imgBuf = await downloadQuotedImage(sock, msg);
      }

      if (!imgBuf) {
        await sock.sendMessage(chatId, {
          text: `❌ Reply to an image or send a photo with caption *${prefix}sticker* to convert it into a sticker.\n\n_NUTTER-XMD ⚡_`,
        }, { quoted: msg }).catch(() => {});
        break;
      }

      try {
        const id = randomUUID();
        const inPath  = join(tmpdir(), `sticker_in_${id}.jpg`);
        const outPath = join(tmpdir(), `sticker_out_${id}.webp`);
        await writeFile(inPath, imgBuf);
        const bin = await FFMPEG_BIN;
        try {
          await execFileAsync(bin, [
            "-y", "-i", inPath,
            "-vf", "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0",
            "-c:v", "libwebp",
            "-lossless", "0",
            "-quality", "80",
            "-loop", "0",
            "-preset", "picture",
            "-an", "-vsync", "0",
            outPath,
          ]);
        } finally {
          await unlink(inPath).catch(() => {});
        }
        const webp = await readFile(outPath);
        await unlink(outPath).catch(() => {});

        await sock.sendMessage(chatId, { sticker: webp }, { quoted: msg });
      } catch {
        await sock.sendMessage(chatId, { text: `❌ Failed to create sticker. Make sure you replied to a clear image.\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
      }
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
      // Get context info from any reply type
      const ctx =
        msg.message?.extendedTextMessage?.contextInfo ??
        msg.message?.imageMessage?.contextInfo ??
        msg.message?.videoMessage?.contextInfo ??
        msg.message?.documentMessage?.contextInfo ??
        msg.message?.audioMessage?.contextInfo;

      const stanzaId = ctx?.stanzaId; // the quoted message's ID
      const quotedMsg = ctx?.quotedMessage;

      if (!quotedMsg || !stanzaId) {
        await sock.sendMessage(chatId, {
          text: `👁️ *View Once Viewer*\n\n• *.vv* — reply to reveal in this chat\n• *.vv2* — reply to reveal privately in your DM\n\nOnly works within *5 minutes* of receiving the view-once.\n\n_NUTTER-XMD ⚡_`,
        }, { quoted: msg }).catch(() => {});
        break;
      }

      // Check if we have the view-once stored and it's within 5 minutes
      const stored = getViewOnce(userId, stanzaId);
      if (!stored) {
        await sock.sendMessage(chatId, {
          text: `⏳ *View-once expired or not found.*\n\nView-once messages can only be revealed within *5 minutes* of receiving them.\n\n_NUTTER-XMD ⚡_`,
        }, { quoted: msg }).catch(() => {});
        break;
      }

      // Unwrap viewOnce from the stored original message
      const storedMsgContent = stored.msg.message;
      const vom: proto.IMessage =
        storedMsgContent?.viewOnceMessage?.message ??
        storedMsgContent?.viewOnceMessageV2?.message ??
        storedMsgContent?.viewOnceMessageV2Extension?.message ??
        quotedMsg; // fallback: use what's in the reply context

      const imgMsg = vom.imageMessage ?? null;
      const vidMsg = vom.videoMessage ?? null;
      const audMsg = vom.audioMessage ?? null;

      if (!imgMsg && !vidMsg && !audMsg) {
        await sock.sendMessage(chatId, {
          text: `❌ No media found. Reply to a view-once photo, video, or voice note.\n\n_NUTTER-XMD ⚡_`,
        }, { quoted: msg }).catch(() => {});
        break;
      }

      const botPhone = (sock.user?.id || "").split(":")[0].split("@")[0];
      const dmJid = `${botPhone}@s.whatsapp.net`;
      const targetJid = command === "vv2" ? dmJid : chatId;
      const senderJid = ctx?.participant ?? ctx?.remoteJid ?? "";
      const senderName = senderJid.split("@")[0] || "someone";
      const ageMin = Math.floor(stored.age / 60000);
      const ageLabel = ageMin < 1 ? "just now" : `${ageMin} min ago`;

      try {
        if (imgMsg) {
          const stream = await downloadContentFromMessage(imgMsg, "image");
          const buffer = await streamToBuffer(stream as unknown as AsyncIterable<Buffer>);
          await sock.sendMessage(targetJid, {
            image: buffer,
            caption: `👁️ *View Once Revealed*\nFrom: @${senderName} (${ageLabel})\n\n_NUTTER-XMD ⚡_`,
          }, command === "vv" ? { quoted: msg } : undefined);
        } else if (vidMsg) {
          const stream = await downloadContentFromMessage(vidMsg, "video");
          const buffer = await streamToBuffer(stream as unknown as AsyncIterable<Buffer>);
          await sock.sendMessage(targetJid, {
            video: buffer,
            caption: `👁️ *View Once Revealed*\nFrom: @${senderName} (${ageLabel})\n\n_NUTTER-XMD ⚡_`,
          }, command === "vv" ? { quoted: msg } : undefined);
        } else if (audMsg) {
          const stream = await downloadContentFromMessage(audMsg, "audio");
          const buffer = await streamToBuffer(stream as unknown as AsyncIterable<Buffer>);
          await sock.sendMessage(targetJid, {
            audio: buffer,
            mimetype: "audio/ogg; codecs=opus",
            pttAudio: true,
          }, command === "vv" ? { quoted: msg } : undefined);
        }
      } catch (e) {
        await sock.sendMessage(chatId, {
          text: `❌ Failed to reveal: ${(e as Error).message || "Media may have expired on WhatsApp's servers."}\n\n_NUTTER-XMD ⚡_`,
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
