// 全專案的「日期邊界」一律以台北時間為準，跟主機所在時區無關：每日簽到重置、
// 每日備份、語音頻道狀態輪替都靠這個判斷「今天是不是換日了」。
// 原本這個函式在 rpgService/backupService/voiceStatusService 各複製了一份逐字相同的實作，
// 三份的時區常數也各自定義，改動時很容易漏改其中一份，抽到這裡統一維護。
export const TAIPEI_TIMEZONE = "Asia/Taipei";

/** 回傳該時間點在台北時區的日期字串，格式固定是 YYYY-MM-DD（en-CA 剛好就是這個格式） */
export function getLocalDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIPEI_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
