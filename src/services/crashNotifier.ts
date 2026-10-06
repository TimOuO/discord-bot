import { Client } from "discord.js";
import { config } from "../config";

// 同一個錯誤在迴圈裡可能每秒噴一次，私訊最多每 10 分鐘一則，其餘只寫 log、併進下一則的計數
const NOTIFY_INTERVAL_MS = 10 * 60 * 1000;
// uncaughtException 之後行程一定要結束，私訊最多等這麼久，送不出去也照樣結束讓 PM2 重開
const EXIT_NOTIFY_TIMEOUT_MS = 5000;
// Discord 訊息上限 2000 字，留空間給標題跟 code block 的符號
const MAX_DETAIL_LENGTH = 1800;

/**
 * 限流器：`tryAcquire()` 回傳這次能不能送，能送的話順便交出「上一則之後被壓下來幾則」，
 * 讓收到的人知道這段期間不只發生一次。
 */
export function createNotifyThrottle(intervalMs: number, now: () => number = Date.now) {
  let lastSentAt: number | null = null;
  let suppressed = 0;

  return {
    tryAcquire(): { allowed: true; suppressed: number } | { allowed: false } {
      const current = now();
      if (lastSentAt !== null && current - lastSentAt < intervalMs) {
        suppressed += 1;
        return { allowed: false };
      }
      const skipped = suppressed;
      lastSentAt = current;
      suppressed = 0;
      return { allowed: true, suppressed: skipped };
    },
  };
}

export function formatCrashMessage(kind: string, error: unknown, suppressed: number): string {
  let detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  if (detail.length > MAX_DETAIL_LENGTH) {
    detail = `${detail.slice(0, MAX_DETAIL_LENGTH)}\n…（已截斷）`;
  }
  const skippedNote =
    suppressed > 0 ? `\n（上次通知之後另外還有 ${suppressed} 則沒有私訊，詳見 log）` : "";
  return `⚠️ 機器人${kind}${skippedNote}\n\`\`\`\n${detail}\n\`\`\``;
}

async function sendDm(client: Client, content: string): Promise<void> {
  // 還沒登入完成就沒辦法私訊；那個階段掛掉的話 log 跟部署通知看得到
  if (!config.backupDmUserId || !client.isReady()) return;
  try {
    const user = await client.users.fetch(config.backupDmUserId);
    await user.send(content);
  } catch (notifyError) {
    console.error("錯誤通知私訊送不出去:", notifyError);
  }
}

/**
 * 接住所有沒被處理到的錯誤，寫 log 並私訊 owner（跟每日備份、deploy.sh 的部署通知同一個收件人）。
 *
 * Node 22 遇到沒被 catch 的 Promise rejection 預設會直接結束行程；PM2 會把 bot 重開，
 * 但沒人會知道剛剛掛過一次。
 * - unhandledRejection：通常只是某一個事件處理失敗，記錄後**繼續跑**，不值得為它重開整個 bot。
 * - uncaughtException：行程狀態可能已經不可信，通知完照樣結束，交給 PM2 重開。
 * - client 的 error 事件：EventEmitter 的 error 沒有人聽的話會直接丟出去變成 uncaughtException。
 *
 * 行程被 OOM 砍掉、整台機器掛掉這種情況，這裡完全沒機會執行，接不到。
 */
export function installCrashNotifier(client: Client): void {
  const throttle = createNotifyThrottle(NOTIFY_INTERVAL_MS);

  const report = (kind: string, error: unknown): Promise<void> => {
    const slot = throttle.tryAcquire();
    if (!slot.allowed) return Promise.resolve();
    return sendDm(client, formatCrashMessage(kind, error, slot.suppressed));
  };

  process.on("unhandledRejection", (reason) => {
    console.error("未處理的 Promise rejection:", reason);
    void report("發生未處理的錯誤（仍在運作）", reason);
  });

  process.on("uncaughtException", (error) => {
    console.error("未捕捉的例外，行程即將結束:", error);
    // 要結束了，不管限流都要送；但最多等幾秒，送不出去也要結束
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, EXIT_NOTIFY_TIMEOUT_MS));
    const notify = sendDm(client, formatCrashMessage("崩潰，即將由 PM2 重新啟動", error, 0));
    Promise.race([notify, timeout]).finally(() => process.exit(1));
  });

  client.on("error", (error) => {
    console.error("Discord client 發生錯誤:", error);
    void report("的 Discord 連線發生錯誤", error);
  });
}
