import { Client, AttachmentBuilder } from "discord.js";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "../config";

const DB_PATH = (process.env.DATABASE_URL ?? "file:./prisma/dev.db").replace(/^file:/, "");
const BACKUP_DIR = path.join(path.dirname(DB_PATH), "backups");
const RETENTION_DAYS = 7;
const TIMEZONE = "Asia/Taipei";

function getLocalDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

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

let lastBackupDate: string | null = null;

async function runBackup(client: Client): Promise<void> {
  if (!config.backupDmUserId) return;

  const today = getLocalDateString(new Date());
  if (today === lastBackupDate) return;
  lastBackupDate = today;

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
  } catch (error) {
    console.error("資料庫備份失敗:", error);
  }
}

// 開機立刻跑一次，之後每 15 分鐘檢查一次日期（台北時區）有沒有變，變了才真的備份一次
export function startDailyBackup(client: Client): void {
  runBackup(client);
  setInterval(() => runBackup(client), 15 * 60 * 1000);
}
