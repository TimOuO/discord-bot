/**
 * 職業系統的純規則：職業定義，以及每個被動要覆寫哪一個既有常數。
 *
 * 設計上刻意讓每個職業只對應**一個遊戲系統**（戰鬥／地下城／強化／生產），
 * 而且被動改的是「規則」不是「數值」——遊戲已經有七種裝備加成，再加一層同質的東西
 * 只會讓職業變成「一件脫不下來的裝備」。詳見 PRD 第 23 節。
 *
 * 這個模組刻意不 import 任何其他 service：它只知道「覆寫成什麼值」，
 * 由各系統自己去決定沒有覆寫時要用哪個預設常數，這樣不會有循環相依。
 */

export const JOB_KEYS = ["berserker", "delver", "smith", "forager"] as const;
export type JobKey = (typeof JOB_KEYS)[number];

export const JOB_LABELS: Record<JobKey, string> = {
  berserker: "血戰鬥神",
  delver: "深淵掠者",
  smith: "星火匠神",
  forager: "荒野獵者",
};

/** 這個職業讓哪一個系統變得不一樣，給選擇畫面分類用 */
export const JOB_SYSTEMS: Record<JobKey, string> = {
  berserker: "戰鬥",
  delver: "地下城",
  smith: "強化",
  forager: "生產",
};

export const JOB_DESCRIPTIONS: Record<JobKey, string> = {
  berserker:
    "打贏後可以連戰至多 5 場，敵人每場 +3 級；整趟保證遭遇 1 隻菁英怪。連戰結束後冷卻 2 分鐘。",
  delver: "地下城的稀有材料從每 4 層一件變成每 3 層一件，下潛同樣深度能多帶一件回來。",
  smith: "強化衝 +6、+7、+8 失敗都不會退級，只損失費用；衝 +9、+10 失敗才照常退一級。",
  forager:
    "釣魚與採集每次擲兩次獨立的骰子（抽中傳說材料的機率從 2.7% 提高到 5.3%），而且絕對不會空手。",
};

/** 到這一級才能轉職 */
export const JOB_UNLOCK_LEVEL = 30;

/** 第一次轉職免費，之後每次要付這麼多金幣 */
export const JOB_CHANGE_COST = 20_000;

export function isJobKey(value: string | null | undefined): value is JobKey {
  return typeof value === "string" && (JOB_KEYS as readonly string[]).includes(value);
}

// ── 各系統的覆寫 ────────────────────────────────────────────
// 回傳 null 代表「這個職業不動這個常數」，呼叫端沿用自己的預設值。
// 用 null 而不是直接回預設值，是為了讓這個模組不必知道各系統的常數是多少。

/** 深淵掠者：地下城材料里程碑改成每幾層一件 */
export function dungeonMaterialIntervalOverride(job: JobKey | null): number | null {
  return job === "delver" ? 3 : null;
}

/**
 * 星火匠神：從「衝到第幾級」開始，失敗才會退級（比較的是要衝到的那一級，不是現在的等級）。
 * 回傳 9 代表衝 +6、+7、+8 都受保護；在 +7 衝 +8 失敗會維持 +7。
 * 傳說材料花在衝 +9/+10，那兩級照樣退級，所以這個被動不會廢掉材料沖水槽
 */
export function enhanceLevelLossFromOverride(job: JobKey | null): number | null {
  return job === "smith" ? 9 : null;
}

/** 荒野獵者：釣魚/採集一次擲幾個獨立的骰子 */
export function gatherRollCount(job: JobKey | null): number {
  return job === "forager" ? 2 : 1;
}

/**
 * 荒野獵者：釣魚/採集的空手率。回 0 代表「絕對不會空手」——
 * 一個以生產為定位的職業還會空手回家，跟它的身分直接矛盾。
 */
export function harvestEmptyChanceOverride(job: JobKey | null): number | null {
  return job === "forager" ? 0 : null;
}

/** 血戰鬥神：一次冷卻內最多能打幾場（1 = 沒有連戰） */
export function maxBattleStreak(job: JobKey | null): number {
  return job === "berserker" ? 5 : 1;
}
