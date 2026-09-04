import { Client, AttachmentBuilder } from "discord.js";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "../config";
import { getLocalDateString } from "../utils/datetime";

const DB_PATH = (process.env.DATABASE_URL ?? "file:./prisma/dev.db").replace(/^file:/, "");
const BACKUP_DIR = path.join(path.dirname(DB_PATH), "backups");
const RETENTION_DAYS = 7;

// 只刪過期的備份檔，不會動到當天剛產生的那份
function pruneOldBackups(): void {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const file of fs.readdirSync(BACKUP_DIR)) {
    if (!file.startsWith("dev-") || !file.endsWith(".db")) continue;
    const filePath = path.join(BACKUP_DIR, file);
    if (fs.statSync(filePath).mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
    }
  }
}

let lastBackupDate: string | null = null; // 最後一次「成功」備份的日期，失敗不會設這個，下次輪詢會再試
let lastFailureNotifiedDate: string | null = null; // 同一天只私訊一次失敗通知，避免每 15 分鐘連續失敗炸一整天的 DM

async function runBackup(client: Client): Promise<void> {
  if (!config.backupDmUserId) return;

  const today = getLocalDateString(new Date());
  if (today === lastBackupDate) return;

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(BACKUP_DIR, `dev-${today}.db`);

  try {
    // 用 better-sqlite3 內建的線上備份，不會鎖住正在運作的資料庫
    const sourceDb = new Database(DB_PATH, { readonly: true });
    await sourceDb.backup(backupPath);
    sourceDb.close();

    pruneOldBackups();

    const user = await client.users.fetch(config.backupDmUserId);
    await user.send({
      content: `📦 資料庫每日備份（${today}）`,
      files: [new AttachmentBuilder(backupPath)],
    });
    console.log(`資料庫備份完成並已私訊送出: ${backupPath}`);
    // 成功才記，失敗的話 lastBackupDate 維持舊值，下一輪（15 分鐘後）會再試一次
    lastBackupDate = today;
  } catch (error) {
    console.error("資料庫備份失敗:", error);

    // 備份/傳送半途失敗可能留下不完整的檔案，清掉避免之後被誤認成正常備份
    try {
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    } catch (cleanupError) {
      console.error("清除失敗備份殘留檔案時發生錯誤:", cleanupError);
    }

    if (lastFailureNotifiedDate !== today) {
      lastFailureNotifiedDate = today;
      try {
        const user = await client.users.fetch(config.backupDmUserId);
        const message = error instanceof Error ? error.message : String(error);
        await user.send(
          `⚠️ 今天（${today}）的資料庫備份失敗了，之後每 15 分鐘會自動重試，成功之前不會再通知。錯誤：${message}`
        );
      } catch (notifyError) {
        console.error("備份失敗通知也送不出去:", notifyError);
      }
    }
  }
}

// 開機立刻跑一次，之後每 15 分鐘檢查一次日期（台北時區）有沒有變，變了才真的備份一次
export function startDailyBackup(client: Client): void {
  runBackup(client);
  setInterval(() => runBackup(client), 15 * 60 * 1000);
}
