import dotenv from "dotenv";
dotenv.config({ quiet: true });

if (!process.env.BOT_TOKEN) {
  throw new Error("缺少Discord機器人Token");
}

// 逗號分隔可以放多個伺服器 ID，例如 GUILD_ID=111,222
// 有設定就用伺服器專屬指令部署（近乎即時生效），沒設定就退回全域部署（最多可能要等 1 小時才會生效）
const guildIds = (process.env.GUILD_ID ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

export const config = {
  token: process.env.BOT_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildIds,
  prefix: "!",
  // messageCreate.ts 的關鍵字彩蛋只對這位使用者觸發；沒設定就整個功能不生效
  messageTriggerUserId: process.env.MESSAGE_TRIGGER_USER_ID,
};
