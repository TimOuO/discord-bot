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
  // 有人跳進語音頻道、自動簽到成功時，公告要發到哪個頻道。
  // 格式：伺服器ID:頻道ID，逗號分隔多組（不同伺服器的頻道 ID 不能共用，所以要各自對應）
  // 例如 DAILY_ANNOUNCE_CHANNEL_ID=111:333,222:444
  dailyAnnounceChannelsByGuild: new Map(
    (process.env.DAILY_ANNOUNCE_CHANNEL_ID ?? "")
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => pair.split(":").map((s) => s.trim()) as [string, string])
  ),
};
