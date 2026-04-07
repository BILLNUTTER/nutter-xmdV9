import { WASocket, proto } from "@whiskeysockets/baileys";
import { UserSettings } from "@workspace/db";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { logger } from "../../lib/logger.js";

const MENU_IMAGE_PATH = join(process.cwd(), "public", "menu-image.png");

export async function handleMenuCommand(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  settings: UserSettings,
  _userId: string
): Promise<void> {
  const chatId = msg.key.remoteJid!;
  const senderName = msg.pushName || "User";
  const prefix = settings.prefix || ".";
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const menuText = `╰► Hey @${(msg.key.participant || msg.key.remoteJid || "").split("@")[0]} 👾
╭───〔 *NUTTER-XMD* 〕──────┈
├──────────────
│✵│▸ 𝐓𝐎𝐓𝐀𝐋 𝐂𝐎𝐌𝐌𝐀𝐍𝐃𝐒: 103
│✵│▸ 𝐏𝐑𝐄𝐅𝐈𝐗: ${prefix}
│✵│▸ 𝐔𝐒𝐄𝐑: ~${senderName}~
│✵│▸ 𝐃𝐀𝐓𝐄: ${dateStr}, ${timeStr}
╰──────────────────────⊷

╭─────「 🇰🇪 AI 」───┈⊷
││◦➛ ${prefix}gpt
││◦➛ ${prefix}gemini
││◦➛ ${prefix}deepseek
││◦➛ ${prefix}blackbox
││◦➛ ${prefix}code
││◦➛ ${prefix}analyze
││◦➛ ${prefix}summarize
││◦➛ ${prefix}translate
││◦➛ ${prefix}recipe
││◦➛ ${prefix}story
││◦➛ ${prefix}teach
││◦➛ ${prefix}generate
╰──────────────┈⊷

╭─────「 ⬇️ DOWNLOADS 」───┈⊷
││◦➛ ${prefix}youtube
││◦➛ ${prefix}song
││◦➛ ${prefix}tiktok
││◦➛ ${prefix}instagram
││◦➛ ${prefix}twitter
││◦➛ ${prefix}facebook
││◦➛ ${prefix}gdrive
││◦➛ ${prefix}mediafire
││◦➛ ${prefix}image
╰──────────────┈⊷

╭─────「 🔊 AUDIO 」───┈⊷
││◦➛ ${prefix}tomp3
││◦➛ ${prefix}toptt
││◦➛ ${prefix}bass
││◦➛ ${prefix}earrape
││◦➛ ${prefix}reverse
││◦➛ ${prefix}robot
││◦➛ ${prefix}deep
╰──────────────┈⊷

╭─────「 😄 FUN 」───┈⊷
││◦➛ ${prefix}fact
││◦➛ ${prefix}jokes
││◦➛ ${prefix}quotes
││◦➛ ${prefix}trivia
││◦➛ ${prefix}truth
││◦➛ ${prefix}dare
││◦➛ ${prefix}truthordare
╰──────────────┈⊷

╭─────「 🔍 SEARCH 」───┈⊷
││◦➛ ${prefix}weather
││◦➛ ${prefix}define
││◦➛ ${prefix}imdb
││◦➛ ${prefix}lyrics
││◦➛ ${prefix}yts
││◦➛ ${prefix}shazam
╰──────────────┈⊷

╭─────「 🛠️ TOOLS 」───┈⊷
││◦➛ ${prefix}sticker
││◦➛ ${prefix}emojimix
││◦➛ ${prefix}qrcode
││◦➛ ${prefix}tinyurl
││◦➛ ${prefix}calculate
││◦➛ ${prefix}genpass
││◦➛ ${prefix}say
││◦➛ ${prefix}getpp
││◦➛ ${prefix}fancy
││◦➛ ${prefix}fliptext
││◦➛ ${prefix}device
││◦➛ ${prefix}disk
││◦➛ ${prefix}ping
││◦➛ ${prefix}runtime
││◦➛ ${prefix}time
││◦➛ ${prefix}repo
││◦➛ ${prefix}botstatus
││◦➛ ${prefix}vv
││◦➛ ${prefix}vv2
││◦➛ ${prefix}test
││◦➛ ${prefix}alive
││◦➛ ${prefix}pair
╰──────────────┈⊷

╭─────「 👥 GROUP 」───┈⊷
││◦➛ ${prefix}kick
││◦➛ ${prefix}promote
││◦➛ ${prefix}demote
││◦➛ ${prefix}add
││◦➛ ${prefix}approve
││◦➛ ${prefix}invite
││◦➛ ${prefix}open
││◦➛ ${prefix}close
││◦➛ ${prefix}poll
││◦➛ ${prefix}tagall
││◦➛ ${prefix}hidetag
││◦➛ ${prefix}kickall
││◦➛ ${prefix}setgroupname
││◦➛ ${prefix}setdesc
╰──────────────┈⊷

╭─────「 ⚙️ SETTINGS 」───┈⊷
││◦➛ ${prefix}anticall
││◦➛ ${prefix}antilink
││◦➛ ${prefix}antisticker
││◦➛ ${prefix}antitag
││◦➛ ${prefix}antibadword
││◦➛ ${prefix}chatbot
││◦➛ ${prefix}autoread
││◦➛ ${prefix}alwaysonline
││◦➛ ${prefix}autoviewstatus
││◦➛ ${prefix}autolikestatus
││◦➛ ${prefix}autotype
││◦➛ ${prefix}antidelete
││◦➛ ${prefix}setlikeemoji
││◦➛ ${prefix}mode
││◦➛ ${prefix}setprefix
││◦➛ ${prefix}setwelcome
││◦➛ ${prefix}setgoodbye
││◦➛ ${prefix}getsettings
╰──────────────┈⊷

╭─────「 👑 OWNER 」───┈⊷
││◦➛ ${prefix}block
││◦➛ ${prefix}unblock
││◦➛ ${prefix}delete
││◦➛ ${prefix}warn
││◦➛ ${prefix}join
││◦➛ ${prefix}leave
││◦➛ ${prefix}online
││◦➛ ${prefix}setbio
││◦➛ ${prefix}restart
╰──────────────┈⊷

_Powered by *NUTTER-XMD* ⚡_
_Type ${prefix}<command> to run_
> *NUTTER-XMD* ⚡`;

  const mentionJid = msg.key.participant || msg.key.remoteJid || "";
  try {
    if (existsSync(MENU_IMAGE_PATH)) {
      const imageBuffer = readFileSync(MENU_IMAGE_PATH);
      await sock.sendMessage(chatId, {
        image: imageBuffer,
        mimetype: "image/png",
        caption: menuText,
        mentions: [mentionJid],
      }, { quoted: msg });
    } else {
      await sock.sendMessage(chatId, {
        text: menuText,
        mentions: [mentionJid],
      }, { quoted: msg });
    }
  } catch (err) {
    logger.error({ err }, "Menu command error");
    await sock.sendMessage(chatId, { text: menuText }).catch(() => {});
  }
}
