import { WASocket, proto } from "@whiskeysockets/baileys";
import { UserSettings } from "@workspace/db";
import ytdl from "@distube/ytdl-core";

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function normalizeTikTokUrl(url: string): Promise<string> {
  // Follow redirects to expand shortened TikTok URLs (vm.tiktok.com, vt.tiktok.com, etc.)
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    const finalUrl = res.url;
    // Return the final URL if it looks like a real TikTok URL
    if (finalUrl.includes("tiktok.com/@") || finalUrl.includes("/video/")) {
      return finalUrl;
    }
    return url;
  } catch {
    return url;
  }
}

async function downloadTikTok(url: string): Promise<{ buffer: Buffer; title: string; type: "video" }> {
  const normalizedUrl = await normalizeTikTokUrl(url);
  const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(normalizedUrl)}&count=12&cursor=0&web=1&hd=1`;
  const data = (await fetchJson(apiUrl)) as { code: number; msg: string; data?: { play: string; wmplay: string; hdplay?: string; music: string; title: string } };
  if (data.code !== 0 || !data.data) {
    throw new Error(data.msg || "TikTok download failed — try copying the full link from the TikTok app");
  }
  // Prefer HD, then no-watermark play, then wmplay
  const videoUrl = data.data.hdplay || data.data.play || data.data.wmplay;
  if (!videoUrl) throw new Error("No video URL returned by TikTok API");
  const buffer = await fetchBuffer(videoUrl);
  return { buffer, title: data.data.title || "TikTok Video", type: "video" };
}

async function downloadYouTubeAudio(urlOrSearch: string): Promise<{ buffer: Buffer; title: string; type: "audio" }> {
  let videoUrl = urlOrSearch;
  if (!urlOrSearch.includes("youtube.com") && !urlOrSearch.includes("youtu.be")) {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(urlOrSearch)}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    const html = await res.text();
    const match = html.match(/"videoId":"([^"]{11})"/);
    if (!match) throw new Error("No YouTube results found");
    videoUrl = `https://www.youtube.com/watch?v=${match[1]}`;
  }

  const info = await ytdl.getInfo(videoUrl);
  const title = info.videoDetails.title;
  const stream = ytdl(videoUrl, { quality: "highestaudio", filter: "audioonly" });
  const buffer = await streamToBuffer(stream);
  return { buffer, title, type: "audio" };
}

async function downloadInstagram(url: string): Promise<{ buffer: Buffer; title: string; type: "video" | "image" }> {
  const apiUrl = `https://instagram-downloader-download-instagram-videos-stories1.p.rapidapi.com/get-info-rapidapi?url=${encodeURIComponent(url)}`;
  const snapistagram = `https://snapsave.app/action.php`;
  const encoded = Buffer.from(url).toString("base64");
  const res = await fetch(`https://snapsave.app/action.php?lang=en&url=${encodeURIComponent(url)}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  const html = await res.text();
  const videoMatch = html.match(/href="(https:\/\/[^"]*\.mp4[^"]*)"/i);
  const imageMatch = html.match(/href="(https:\/\/[^"]*\.jpg[^"]*)"/i);
  if (videoMatch) {
    const buffer = await fetchBuffer(videoMatch[1]);
    return { buffer, title: "Instagram Video", type: "video" };
  }
  if (imageMatch) {
    const buffer = await fetchBuffer(imageMatch[1]);
    return { buffer, title: "Instagram Image", type: "image" };
  }
  throw new Error("Could not extract Instagram media");
}

async function downloadTwitter(url: string): Promise<{ buffer: Buffer; title: string; type: "video" | "image" }> {
  const tweetId = url.match(/status\/(\d+)/)?.[1];
  if (!tweetId) throw new Error("Invalid Twitter/X URL");
  const vxUrl = `https://api.vxtwitter.com/Twitter/status/${tweetId}`;
  const data = (await fetchJson(vxUrl)) as {
    text?: string;
    media_extended?: Array<{ url: string; type: string; thumbnail_url?: string }>;
  };
  const media = data.media_extended?.[0];
  if (!media) throw new Error("No media found in tweet");
  const buffer = await fetchBuffer(media.url);
  return {
    buffer,
    title: data.text || "Twitter Media",
    type: media.type === "video" ? "video" : "image",
  };
}

export async function handleDownloadCommand(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  settings: UserSettings,
  _userId: string,
  command: string,
  args: string[]
): Promise<void> {
  const chatId = msg.key.remoteJid!;
  const prefix = settings.prefix || ".";
  const url = args[0] || "";

  switch (command) {
    case "tiktok": {
      if (!url) {
        await sock.sendMessage(chatId, { text: `Usage: *${prefix}tiktok* <url>\n\nExample:\n${prefix}tiktok https://vm.tiktok.com/xxx\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
        return;
      }
      await sock.sendMessage(chatId, { text: `⏳ Downloading TikTok video...\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
      try {
        const { buffer, title } = await downloadTikTok(url);
        await sock.sendMessage(chatId, {
          video: buffer,
          caption: `🎵 *${title}*\n\n_Downloaded by NUTTER-XMD ⚡_`,
          mimetype: "video/mp4",
        }, { quoted: msg });
      } catch (e) {
        await sock.sendMessage(chatId, {
          text: `❌ TikTok download failed: ${(e as Error).message || "Try a different link"}\n\n_NUTTER-XMD ⚡_`,
        }, { quoted: msg }).catch(() => {});
      }
      break;
    }

    case "youtube":
    case "song": {
      const query = args.join(" ");
      if (!query) {
        await sock.sendMessage(chatId, {
          text: `Usage: *${prefix}${command}* <url or search term>\n\nExamples:\n${prefix}song Never Gonna Give You Up\n${prefix}youtube https://youtu.be/xxx\n\n_NUTTER-XMD ⚡_`,
        }, { quoted: msg }).catch(() => {});
        return;
      }
      await sock.sendMessage(chatId, { text: `⏳ Downloading audio...\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
      try {
        const { buffer, title } = await downloadYouTubeAudio(query);
        await sock.sendMessage(chatId, {
          audio: buffer,
          mimetype: "audio/mp4",
          pttAudio: false,
        }, { quoted: msg });
        await sock.sendMessage(chatId, {
          text: `🎵 *${title}*\n\n_Downloaded by NUTTER-XMD ⚡_`,
        }, { quoted: msg }).catch(() => {});
      } catch (e) {
        await sock.sendMessage(chatId, {
          text: `❌ YouTube download failed: ${(e as Error).message || "Try a different link or search term"}\n\n_NUTTER-XMD ⚡_`,
        }, { quoted: msg }).catch(() => {});
      }
      break;
    }

    case "instagram": {
      if (!url) {
        await sock.sendMessage(chatId, { text: `Usage: *${prefix}instagram* <url>\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
        return;
      }
      await sock.sendMessage(chatId, { text: `⏳ Downloading Instagram media...\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
      try {
        const { buffer, title, type } = await downloadInstagram(url);
        if (type === "video") {
          await sock.sendMessage(chatId, { video: buffer, caption: `📸 *${title}*\n\n_Downloaded by NUTTER-XMD ⚡_` }, { quoted: msg });
        } else {
          await sock.sendMessage(chatId, { image: buffer, caption: `📸 *${title}*\n\n_Downloaded by NUTTER-XMD ⚡_` }, { quoted: msg });
        }
      } catch (e) {
        await sock.sendMessage(chatId, {
          text: `❌ Instagram download failed: ${(e as Error).message || "Try a different link"}\n\n_NUTTER-XMD ⚡_`,
        }, { quoted: msg }).catch(() => {});
      }
      break;
    }

    case "twitter": {
      if (!url) {
        await sock.sendMessage(chatId, { text: `Usage: *${prefix}twitter* <tweet url>\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
        return;
      }
      await sock.sendMessage(chatId, { text: `⏳ Downloading Twitter media...\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
      try {
        const { buffer, title, type } = await downloadTwitter(url);
        if (type === "video") {
          await sock.sendMessage(chatId, { video: buffer, caption: `🐦 *${title}*\n\n_Downloaded by NUTTER-XMD ⚡_`, mimetype: "video/mp4" }, { quoted: msg });
        } else {
          await sock.sendMessage(chatId, { image: buffer, caption: `🐦 *${title}*\n\n_Downloaded by NUTTER-XMD ⚡_` }, { quoted: msg });
        }
      } catch (e) {
        await sock.sendMessage(chatId, {
          text: `❌ Twitter download failed: ${(e as Error).message || "Try a different link"}\n\n_NUTTER-XMD ⚡_`,
        }, { quoted: msg }).catch(() => {});
      }
      break;
    }

    case "facebook": {
      if (!url) {
        await sock.sendMessage(chatId, { text: `Usage: *${prefix}facebook* <url>\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
        return;
      }
      await sock.sendMessage(chatId, { text: `⏳ Processing Facebook link...\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
      try {
        const data = (await fetchJson(`https://www.facebook.com/plugins/video/iframe/?href=${encodeURIComponent(url)}`)) as Record<string, unknown>;
        const hdUrl = data.hd_src as string || data.sd_src as string;
        if (!hdUrl) throw new Error("No video source found");
        const buffer = await fetchBuffer(hdUrl);
        await sock.sendMessage(chatId, { video: buffer, caption: `📘 *Facebook Video*\n\n_Downloaded by NUTTER-XMD ⚡_` }, { quoted: msg });
      } catch {
        await sock.sendMessage(chatId, {
          text: `❌ Facebook download failed. For now, please use a third-party site like *fbdown.net* or *savefrom.net* to download Facebook videos.\n\n_NUTTER-XMD ⚡_`,
        }, { quoted: msg }).catch(() => {});
      }
      break;
    }

    case "gdrive": {
      if (!url) {
        await sock.sendMessage(chatId, { text: `Usage: *${prefix}gdrive* <url>\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
        return;
      }
      const driveMatch = url.match(/\/d\/([^/]+)/);
      if (!driveMatch) {
        await sock.sendMessage(chatId, { text: `❌ Invalid Google Drive URL\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
        return;
      }
      const fileId = driveMatch[1];
      const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
      await sock.sendMessage(chatId, {
        text: `📁 *Google Drive Download*\n\nFile ID: \`${fileId}\`\n\n🔗 Direct link:\n${directUrl}\n\n_NUTTER-XMD ⚡_`,
      }, { quoted: msg }).catch(() => {});
      break;
    }

    case "mediafire": {
      if (!url) {
        await sock.sendMessage(chatId, { text: `Usage: *${prefix}mediafire* <url>\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
        return;
      }
      try {
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        const html = await res.text();
        const match = html.match(/href="(https:\/\/download[^"]+mediafire[^"]+)"/i);
        if (!match) throw new Error("No download link found");
        await sock.sendMessage(chatId, {
          text: `📦 *MediaFire Download*\n\n🔗 Download link:\n${match[1]}\n\n_NUTTER-XMD ⚡_`,
        }, { quoted: msg }).catch(() => {});
      } catch {
        await sock.sendMessage(chatId, {
          text: `❌ Failed to extract MediaFire download link.\n\n_NUTTER-XMD ⚡_`,
        }, { quoted: msg }).catch(() => {});
      }
      break;
    }

    case "image": {
      const query = args.join(" ");
      if (!query) {
        await sock.sendMessage(chatId, { text: `Usage: *${prefix}image* <search term>\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
        return;
      }
      try {
        const searchUrl = `https://source.unsplash.com/800x600/?${encodeURIComponent(query)}`;
        const res = await fetch(searchUrl, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" } });
        const buffer = Buffer.from(await res.arrayBuffer());
        await sock.sendMessage(chatId, {
          image: buffer,
          caption: `🖼️ *${query}*\n\n_Powered by Unsplash × NUTTER-XMD ⚡_`,
        }, { quoted: msg });
      } catch {
        await sock.sendMessage(chatId, { text: `❌ Image search failed. Try again.\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
      }
      break;
    }

    default:
      await sock.sendMessage(chatId, { text: `⬇️ Unknown download command.\n\n_NUTTER-XMD ⚡_` }, { quoted: msg }).catch(() => {});
  }
}
