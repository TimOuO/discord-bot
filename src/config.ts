import dotenv from "dotenv";
dotenv.config({ quiet: true });

if (!process.env.BOT_TOKEN) {
  throw new Error("缺少Discord機器人Token");
}

export const config = {
  token: process.env.BOT_TOKEN,
  clientId: process.env.CLIENT_ID,
  prefix: "!",
  // messageCreate.ts 的關鍵字彩蛋只對這位使用者觸發；沒設定就整個功能不生效
  messageTriggerUserId: process.env.MESSAGE_TRIGGER_USER_ID,
};
