import dotenv from "dotenv";
dotenv.config();

if (!process.env.BOT_TOKEN) {
  throw new Error("缺少Discord機器人Token");
}

if (!process.env.GEMINI_API_KEY) {
  throw new Error("缺少Gemini API密鑰");
}

export const config = {
  token: process.env.BOT_TOKEN,
  clientId: process.env.CLIENT_ID,
  prefix: "!",
  geminiApiKey: process.env.GEMINI_API_KEY
};
