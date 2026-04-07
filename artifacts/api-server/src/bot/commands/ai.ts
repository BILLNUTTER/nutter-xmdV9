import { WASocket, proto } from "@whiskeysockets/baileys";
import { UserSettings } from "@workspace/db";
import OpenAI from "openai";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const apiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "placeholder";
    if (!baseURL) throw new Error("AI_INTEGRATIONS_OPENAI_BASE_URL not set");
    _openai = new OpenAI({ baseURL, apiKey });
  }
  return _openai;
}

function getQuotedText(msg: proto.IWebMessageInfo): string {
  const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!q) return "";
  return (
    q.conversation ||
    q.extendedTextMessage?.text ||
    q.imageMessage?.caption ||
    q.videoMessage?.caption ||
    ""
  );
}

const SYSTEM: Record<string, string> = {
  gpt:       "You are a helpful AI assistant called NUTTER-XMD. Be concise and friendly.",
  gemini:    "You are a smart AI assistant called NUTTER-XMD powered by advanced AI. Be helpful and concise.",
  deepseek:  "You are a deep-thinking AI assistant called NUTTER-XMD. Reason carefully before answering.",
  blackbox:  "You are an expert coding and general AI assistant called NUTTER-XMD. Focus on practical answers.",
  code:      "You are an expert programmer. Generate clean, well-commented code. Format code in code blocks.",
  analyze:   "You are an analytical assistant. Analyze the provided text thoroughly and give structured insights.",
  summarize: "You are a summarization expert. Provide a clear, concise summary with key points.",
  translate: "You are a professional translator. Translate accurately and naturally.",
  recipe:    "You are a professional chef. Provide detailed recipes with ingredients and step-by-step instructions.",
  story:     "You are a creative storyteller. Write engaging short stories with vivid details.",
  teach:     "You are an expert teacher. Explain topics clearly with examples and analogies.",
  generate:  "You are a creative content generator. Produce high-quality content based on the request.",
};

const USAGE: Record<string, string> = {
  gpt:       "Usage: *.gpt <question>* or reply to a message.",
  gemini:    "Usage: *.gemini <question>* or reply to a message.",
  deepseek:  "Usage: *.deepseek <question>* or reply to a message.",
  blackbox:  "Usage: *.blackbox <question>* or reply to a message.",
  code:      "Usage: *.code <language> <description>*\nExample: .code python sort a list",
  analyze:   "Usage: *.analyze <text>* or reply to a message.",
  summarize: "Usage: *.summarize <text>* or reply to a message.",
  translate: "Usage: *.translate <language> <text>*\nExample: .translate French Hello world",
  recipe:    "Usage: *.recipe <dish name>*\nExample: .recipe spaghetti carbonara",
  story:     "Usage: *.story <theme>*\nExample: .story a brave lion in the savanna",
  teach:     "Usage: *.teach <topic>*\nExample: .teach how black holes work",
  generate:  "Usage: *.generate <type> <description>*\nExample: .generate caption sunset photo",
};

function buildUserPrompt(command: string, args: string[], quotedText: string): string {
  const argText = args.join(" ").trim();
  const input = argText || quotedText;

  switch (command) {
    case "translate": {
      const [lang, ...rest] = args;
      const text = rest.join(" ") || quotedText;
      if (!lang || !text) return "";
      return `Translate the following text to ${lang}:\n\n${text}`;
    }
    case "code": {
      const [lang, ...rest] = args;
      const desc = rest.join(" ") || quotedText;
      if (!desc) return "";
      return `Write ${lang || "code"} for: ${desc}`;
    }
    default:
      return input;
  }
}

export async function handleAICommand(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  settings: UserSettings,
  _userId: string,
  command: string,
  args: string[]
): Promise<void> {
  const chatId = msg.key.remoteJid!;
  const prefix = settings.prefix || ".";
  const quotedText = getQuotedText(msg);
  const userPrompt = buildUserPrompt(command, args, quotedText);

  if (!userPrompt) {
    const usage = USAGE[command] || `Usage: *${prefix}${command} <query>*`;
    await sock.sendMessage(chatId, {
      text: `🇰🇪 *${command.toUpperCase()}*\n\n${usage}\n\n_NUTTER-XMD ⚡_`,
    }, { quoted: msg }).catch(() => {});
    return;
  }

  const system = SYSTEM[command] || "You are a helpful assistant called NUTTER-XMD.";

  try {
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 1024,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
    });
    const reply = completion.choices[0]?.message?.content?.trim() || "No response.";
    await sock.sendMessage(chatId, {
      text: `🇰🇪 *${command.toUpperCase()}*\n\n${reply}\n\n_NUTTER-XMD ⚡_`,
    }, { quoted: msg }).catch(() => {});
  } catch (err) {
    const msg2 = err instanceof Error ? err.message : String(err);
    await sock.sendMessage(chatId, {
      text: `❌ AI error: ${msg2}\n\n_NUTTER-XMD ⚡_`,
    }, { quoted: msg }).catch(() => {});
  }
}
