import { WASocket, proto } from "@whiskeysockets/baileys";
import { UserSettings } from "@workspace/db";

const AI_RESPONSES: Record<string, string> = {
  gpt: "🇰🇪 *GPT*\n\nThis feature requires an OpenAI API key.\nContact the bot admin to enable AI features.\n\n_NUTTER-XMD ⚡_",
  gemini: "🇰🇪 *Gemini*\n\nThis feature requires a Google AI API key.\nContact the bot admin to enable AI features.\n\n_NUTTER-XMD ⚡_",
  deepseek: "🇰🇪 *DeepSeek*\n\nThis feature requires a DeepSeek API key.\nContact the bot admin to enable AI features.\n\n_NUTTER-XMD ⚡_",
  blackbox: "🇰🇪 *Blackbox AI*\n\nThis feature requires API access.\nContact the bot admin to enable AI features.\n\n_NUTTER-XMD ⚡_",
  code: "💻 *Code Generator*\n\nThis feature requires an AI API key.\nUsage: .code <language> <description>\n\n_NUTTER-XMD ⚡_",
  analyze: "🔍 *Analyzer*\n\nThis feature requires an AI API key.\nUsage: .analyze <text or image>\n\n_NUTTER-XMD ⚡_",
  summarize: "📝 *Summarizer*\n\nThis feature requires an AI API key.\nUsage: .summarize <text>\n\n_NUTTER-XMD ⚡_",
  translate: "🌍 *Translator*\n\nThis feature requires an AI API key.\nUsage: .translate <language> <text>\n\n_NUTTER-XMD ⚡_",
  recipe: "🍳 *Recipe Generator*\n\nThis feature requires an AI API key.\nUsage: .recipe <dish name>\n\n_NUTTER-XMD ⚡_",
  story: "📖 *Story Generator*\n\nThis feature requires an AI API key.\nUsage: .story <theme>\n\n_NUTTER-XMD ⚡_",
  teach: "📚 *Teacher Bot*\n\nThis feature requires an AI API key.\nUsage: .teach <topic>\n\n_NUTTER-XMD ⚡_",
  generate: "🎨 *Content Generator*\n\nThis feature requires an AI API key.\nUsage: .generate <type> <description>\n\n_NUTTER-XMD ⚡_",
};

export async function handleAICommand(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  settings: UserSettings,
  _userId: string,
  command: string,
  _args: string[]
): Promise<void> {
  const chatId = msg.key.remoteJid!;
  const response = AI_RESPONSES[command] || `🇰🇪 AI feature: *${command}*\n\nThis feature requires an API key.\n\n_NUTTER-XMD ⚡_`;
  await sock.sendMessage(chatId, { text: response }, { quoted: msg }).catch(() => {});
}
