import { REST, Routes } from "discord.js";
import { randomInt } from "../utils/random";
import { getLocalDateString } from "../utils/datetime";
import { config } from "../config";

// 每個詞庫名稱對應一組候選詞，每天隨機挑一句
const PHRASE_POOLS: Record<string, string[]> = {
  cat: [
    "喵喵~",
    "呼嚕呼嚕 🐱",
    "喵嗚喵嗚",
    "貓貓在睡覺",
    "今天也要喵喵",
    "麻糬糖糖上線中",
  ],
  pigsLots: [
    "好多🐷🐷",
    "豬豬派對 🎉",
    "全部都是🐷",
    "噗噗快樂日",
    "豬豬集合啦",
    "今天也很可愛 🐽",
  ],
  pigsTogether: [
    "一起當🐖",
    "🐖🐖聚會中",
    "快樂豬豬",
    "一起變半斤八兩",
    "豬豬同盟 🤝",
    "呼呼一起睡 💤",
  ],
};

let lastRotatedDate: string | null = null;

async function rotateVoiceStatuses(rest: REST): Promise<void> {
  const today = getLocalDateString(new Date());
  if (today === lastRotatedDate) return;
  lastRotatedDate = today;

  for (const [channelId, themeKey] of config.voiceStatusChannels) {
    const pool = PHRASE_POOLS[themeKey];
    if (!pool || pool.length === 0) {
      console.log(
        `警告: 語音頻道 ${channelId} 指定的詞庫 "${themeKey}" 不存在或是空的`,
      );
      continue;
    }

    const status = pool[randomInt(0, pool.length)];
    try {
      await rest.put(Routes.channelVoiceStatus(channelId), {
        body: { status },
      });
      console.log(`語音頻道狀態已更新 ${channelId} -> "${status}"`);
    } catch (error) {
      console.error(`更新語音頻道狀態失敗 ${channelId}:`, error);
    }
  }
}

// 開機時立刻跑一次，之後每 15 分鐘檢查一次日期（台北時區）有沒有變，變了才真的換
export function startDailyVoiceStatusRotation(rest: REST): void {
  if (config.voiceStatusChannels.size === 0) return;

  rotateVoiceStatuses(rest);
  setInterval(() => rotateVoiceStatuses(rest), 15 * 60 * 1000);
}
