import { WASocket, proto, downloadMediaMessage } from "@whiskeysockets/baileys";
import { UserSettings } from "@workspace/db";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

function ffmpegPath(): string {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

async function applyFfmpeg(
  inputBuf: Buffer,
  inputExt: string,
  outputExt: string,
  filterArgs: string[]
): Promise<Buffer> {
  const id = randomUUID();
  const inPath  = join(tmpdir(), `nutter_in_${id}.${inputExt}`);
  const outPath = join(tmpdir(), `nutter_out_${id}.${outputExt}`);
  await writeFile(inPath, inputBuf);
  try {
    await execFileAsync(ffmpegPath(), [
      "-y", "-i", inPath,
      ...filterArgs,
      outPath,
    ]);
    return await readFile(outPath);
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

function getQuotedMessage(msg: proto.IWebMessageInfo): proto.IMessage | null {
  return msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ?? null;
}

function detectMediaType(qm: proto.IMessage): "audio" | "video" | "ptt" | null {
  if (qm.audioMessage) return qm.audioMessage.ptt ? "ptt" : "audio";
  if (qm.videoMessage) return "video";
  return null;
}

async function downloadQuotedMedia(
  sock: WASocket,
  msg: proto.IWebMessageInfo
): Promise<{ buffer: Buffer; type: "audio" | "video" | "ptt" } | null> {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage || !ctx.participant || !ctx.stanzaId) return null;

  const qm = ctx.quotedMessage;
  const type = detectMediaType(qm);
  if (!type) return null;

  const fakeMsg: proto.IWebMessageInfo = {
    key: {
      remoteJid: msg.key.remoteJid,
      fromMe: ctx.participant === (sock as any).user?.id,
      id: ctx.stanzaId,
      participant: ctx.participant,
    },
    message: qm,
  };

  try {
    const stream = await downloadMediaMessage(
      fakeMsg,
      "buffer",
      {},
      { logger: undefined as any, reuploadRequest: sock.updateMediaMessage }
    ) as Buffer;
    return { buffer: stream, type };
  } catch {
    return null;
  }
}

const EFFECTS: Record<string, {
  filterArgs: (inputExt: string) => string[];
  outExt: string;
  asPtt: boolean;
}> = {
  robot: {
    filterArgs: () => ["-af", "afftfilt=real=\'hypot(re,im)*sin(0)\':imag=\'hypot(re,im)*cos(0)\':win_size=512:overlap=0.75,aecho=0.8:0.88:60:0.4"],
    outExt: "ogg",
    asPtt: true,
  },
  deep: {
    filterArgs: () => ["-af", "asetrate=44100*0.75,aresample=44100,atempo=1.33"],
    outExt: "ogg",
    asPtt: true,
  },
  bass: {
    filterArgs: () => ["-af", "equalizer=f=60:t=o:w=2:g=12,equalizer=f=120:t=o:w=2:g=6"],
    outExt: "ogg",
    asPtt: true,
  },
  earrape: {
    filterArgs: () => ["-af", "volume=15,acrusher=level_in=4:level_out=4:bits=8:mode=log:aa=1"],
    outExt: "ogg",
    asPtt: true,
  },
  reverse: {
    filterArgs: () => ["-af", "areverse"],
    outExt: "ogg",
    asPtt: true,
  },
  toptt: {
    filterArgs: () => ["-af", "aresample=16000", "-c:a", "libopus", "-b:a", "64k", "-vbr", "on"],
    outExt: "ogg",
    asPtt: true,
  },
  tomp3: {
    filterArgs: () => ["-vn", "-acodec", "libmp3lame", "-q:a", "4"],
    outExt: "mp3",
    asPtt: false,
  },
};

export async function handleAudioCommand(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  settings: UserSettings,
  _userId: string,
  command: string,
  _args: string[]
): Promise<void> {
  const chatId = msg.key.remoteJid!;
  const prefix = settings.prefix || ".";

  const effect = EFFECTS[command];
  if (!effect) {
    await sock.sendMessage(chatId, {
      text: `🔊 Unknown audio command: *${command}*\n\n_NUTTER-XMD ⚡_`,
    }, { quoted: msg }).catch(() => {});
    return;
  }

  const needsVideo = command === "tomp3";
  const mediaLabel = needsVideo ? "video or audio" : "audio/voice note";

  const media = await downloadQuotedMedia(sock, msg);
  if (!media) {
    await sock.sendMessage(chatId, {
      text: `🎵 *${command.toUpperCase()}*\n\nReply to a ${mediaLabel} message with *${prefix}${command}*\n\n_NUTTER-XMD ⚡_`,
    }, { quoted: msg }).catch(() => {});
    return;
  }

  if (command === "tomp3" && media.type !== "video") {
    await sock.sendMessage(chatId, {
      text: `🎵 *TOMP3*\n\nReply to a *video* message with *${prefix}tomp3*\n\n_NUTTER-XMD ⚡_`,
    }, { quoted: msg }).catch(() => {});
    return;
  }

  try {
    const inputExt = media.type === "video" ? "mp4" : "ogg";
    const filterArgs = effect.filterArgs(inputExt);
    const processed = await applyFfmpeg(media.buffer, inputExt, effect.outExt, filterArgs);

    if (effect.asPtt) {
      await sock.sendMessage(chatId, {
        audio: processed,
        mimetype: "audio/ogg; codecs=opus",
        ptt: true,
      }, { quoted: msg });
    } else {
      await sock.sendMessage(chatId, {
        audio: processed,
        mimetype: "audio/mpeg",
        fileName: `nutter_${command}.mp3`,
      }, { quoted: msg });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await sock.sendMessage(chatId, {
      text: `❌ Audio processing failed: ${errMsg.slice(0, 200)}\n\n_NUTTER-XMD ⚡_`,
    }, { quoted: msg }).catch(() => {});
  }
}
