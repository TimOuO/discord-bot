/**
 * 成就與稱號的純規則：成就清單、條件、給的能力值，以及稱號店的商品。
 *
 * 跟 jobs.ts 一樣刻意不 import 任何其他 service，也不碰資料庫——
 * 條件只看呼叫端餵進來的一份狀態快照（AchievementSnapshot），
 * 所以整組閾值與獎勵都能在不開資料庫的情況下被測到。
 *
 * 為什麼成就要記錄而不是每次重新推導，見 docs/adr/0005。
 */

import { JOB_KEYS, JOB_LABELS, type JobKey } from "./jobs";

/**
 * 判斷成就用的狀態快照。每一項都是「現在查得到的值」——
 * 刻意不含任何累積次數（打過幾場、釣過幾條），這個遊戲沒有那種計數器。
 */
export interface AchievementSnapshot {
  level: number;
  gold: number;
  /** 連續簽到天數。斷掉會歸零，但成就已經記下的不會收回 */
  loginStreak: number;
  /** 所有裝備實體裡最高的強化等級 */
  maxEnhanceLevel: number;
  /** 持有幾件神話稀有度的裝備實體（含沒穿在身上的） */
  mythicItemCount: number;
  /** 庫存裡傳說稀有度的魚/材料總數量 */
  legendaryMaterialCount: number;
  /** 目前的職業。四個職業成就靠「現在是這個職業」偵測，靠永久記錄累積成歷史 */
  job: JobKey | null;
}

/** 成就能給的五種能力值。金幣加成/經驗加成刻意不給——那會直接放大產出速度 */
export interface AchievementBonus {
  attack: number;
  defense: number;
  maxHealth: number;
  critRate: number;
  dodgeRate: number;
}

export interface AchievementDefinition {
  key: string;
  /** 分類，只給顯示用的分組 */
  group: string;
  label: string;
  /** 條件的白話說明，要讓玩家知道還差多少 */
  requirement: string;
  /** 達成時附贈的稱號 */
  title: string;
  reward: Partial<AchievementBonus>;
  met(snapshot: AchievementSnapshot): boolean;
}

const levelTier = (
  level: number,
  label: string,
  title: string,
  reward: Partial<AchievementBonus>
): AchievementDefinition => ({
  key: `level_${level}`,
  group: "等級",
  label,
  requirement: `達到 Lv${level}`,
  title,
  reward,
  met: (s) => s.level >= level,
});

const enhanceTier = (
  enhanceLevel: number,
  label: string,
  title: string,
  reward: Partial<AchievementBonus>
): AchievementDefinition => ({
  key: `enhance_${enhanceLevel}`,
  group: "強化",
  label,
  requirement: `把任何一件裝備強化到 +${enhanceLevel}`,
  title,
  reward,
  met: (s) => s.maxEnhanceLevel >= enhanceLevel,
});

const goldTier = (
  gold: number,
  label: string,
  title: string,
  reward: Partial<AchievementBonus>
): AchievementDefinition => ({
  key: `gold_${gold}`,
  group: "財富",
  label,
  requirement: `同時持有 ${gold.toLocaleString("en-US")} 金幣`,
  title,
  reward,
  met: (s) => s.gold >= gold,
});

const streakTier = (
  days: number,
  label: string,
  title: string,
  reward: Partial<AchievementBonus>
): AchievementDefinition => ({
  key: `streak_${days}`,
  group: "簽到",
  label,
  requirement: `連續簽到 ${days} 天`,
  title,
  reward,
  met: (s) => s.loginStreak >= days,
});

const mythicTier = (
  count: number,
  label: string,
  title: string,
  reward: Partial<AchievementBonus>
): AchievementDefinition => ({
  key: `mythic_${count}`,
  group: "收藏",
  label,
  requirement: `持有 ${count} 件神話裝備`,
  title,
  reward,
  met: (s) => s.mythicItemCount >= count,
});

/** 四個職業成就。「當過」是靠成就永久記錄累積出來的，資料庫沒有職業歷史 */
const JOB_TITLES: Record<JobKey, string> = {
  berserker: "嗜血者",
  delver: "深淵歸來者",
  smith: "執爐人",
  forager: "荒野嚮導",
};

const jobAchievement = (job: JobKey): AchievementDefinition => ({
  key: `job_${job}`,
  group: "職業",
  label: `成為${JOB_LABELS[job]}`,
  requirement: `轉職成為${JOB_LABELS[job]}（成就會永久保留，換職業不會失去）`,
  title: JOB_TITLES[job],
  reward: { dodgeRate: 1 },
  met: (s) => s.job === job,
});

/**
 * 成就總量刻意封頂在「相當於 2 成的一整套 +10 神話裝」：
 * 攻 72 / 防 50 / 血 60 / 爆擊 8% / 閃避 6%。
 *
 * 這個數字是模擬出來的，不是猜的：一整套 +10 神話裝是 攻 360 / 防 250 / 血 300 /
 * 爆擊 40% / 閃避 32%，而在只有裝備的情況下「連續 30 場」的勝率到 Lv400 會掉到 87%、
 * Lv600 掉到 61%（PRD 第 15 節的對稱成長問題）。補上 2 成的成就加成後 Lv400 回到 100%、
 * Lv600 回到 87%，剛好把天花板往後推一大段，又不會讓裝備變得無關緊要。
 */
export const ACHIEVEMENT_BUDGET: AchievementBonus = {
  attack: 72,
  defense: 50,
  maxHealth: 60,
  critRate: 8,
  dodgeRate: 6,
};

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  levelTier(10, "見習冒險者", "見習冒險者", { attack: 2 }),
  levelTier(30, "熟練冒險者", "熟練冒險者", { attack: 5 }),
  levelTier(60, "百戰老兵", "百戰老兵", { attack: 10 }),
  levelTier(100, "傳說英雄", "傳說英雄", { attack: 20 }),

  enhanceTier(5, "初試鍛爐", "初試鍛爐", { attack: 5 }),
  enhanceTier(8, "淬火不悔", "淬火不悔", { attack: 10 }),
  enhanceTier(10, "極限鍛造", "極限鍛造", { attack: 20 }),

  goldTier(10_000, "小有積蓄", "小有積蓄", { maxHealth: 10 }),
  goldTier(100_000, "一方富商", "一方富商", { maxHealth: 20 }),
  goldTier(500_000, "坐擁金山", "坐擁金山", { maxHealth: 30 }),

  streakTier(7, "風雨無阻", "風雨無阻", { defense: 5 }),
  streakTier(30, "月月不缺", "月月不缺", { defense: 15 }),
  streakTier(100, "百日不輟", "百日不輟", { defense: 30 }),

  mythicTier(1, "初獲神話", "初獲神話", { critRate: 2 }),
  mythicTier(5, "神話收藏家", "神話收藏家", { critRate: 6 }),

  {
    key: "legendary_material_10",
    group: "收藏",
    label: "囤料成癖",
    requirement: "庫存裡同時有 10 個傳說材料（魚或採集材料）",
    title: "囤料成癖",
    reward: { dodgeRate: 2 },
    met: (s) => s.legendaryMaterialCount >= 10,
  },

  ...JOB_KEYS.map(jobAchievement),
];

export type AchievementKey = string;

export function findAchievement(key: string): AchievementDefinition | undefined {
  return ACHIEVEMENTS.find((a) => a.key === key);
}

/** 這份快照現在符合哪些成就的條件。回傳的順序跟 ACHIEVEMENTS 一致 */
export function achievedKeys(snapshot: AchievementSnapshot): AchievementKey[] {
  return ACHIEVEMENTS.filter((a) => a.met(snapshot)).map((a) => a.key);
}

const ZERO_BONUS: AchievementBonus = {
  attack: 0,
  defense: 0,
  maxHealth: 0,
  critRate: 0,
  dodgeRate: 0,
};

/**
 * 已解鎖的成就加起來給多少能力值。
 * 認不出來的 key 一律忽略（閾值調動後可能留著舊紀錄），重複的 key 只算一次——
 * 資料庫有 unique 約束擋重複，但這是純函式，不該假設呼叫端餵進來的一定乾淨。
 */
export function achievementBonus(keys: readonly string[]): AchievementBonus {
  const total = { ...ZERO_BONUS };
  for (const key of new Set(keys)) {
    const reward = findAchievement(key)?.reward;
    if (!reward) continue;
    for (const stat of Object.keys(total) as (keyof AchievementBonus)[]) {
      total[stat] += reward[stat] ?? 0;
    }
  }
  return total;
}

// ── 稱號 ────────────────────────────────────────────────────
// 稱號純顯示，永遠不影響任何數值（能力值是「成就」給的，稱號只是它順便附上的裝飾）。
// 來源有兩種：成就附贈，或在稱號店用金幣買。

export interface TitleDefinition {
  key: string;
  text: string;
  source: "achievement" | "shop";
  /** 只有稱號店的商品有價格 */
  cost?: number;
}

/**
 * 稱號店：純粹的金幣沖水槽。
 *
 * 動機是正式環境的實際狀況——兩個長期玩家分別存了 17 萬跟 34 萬金幣，
 * 而遊戲裡已經沒有任何值得買的東西（商店的裝備早就被神話鍛造裝取代）。
 * 刻意只賣不影響數值的東西：一個能用金幣買到戰鬥力的商店會讓金幣變成第二套裝備系統。
 * 最貴的那個標到 100 萬，是為了讓最有錢的玩家也還有一個存得到的目標。
 */
export const TITLE_SHOP: readonly TitleDefinition[] = [
  { key: "shop_newcomer", text: "初來寶地", source: "shop", cost: 5_000 },
  { key: "shop_dreamer", text: "白日夢想家", source: "shop", cost: 15_000 },
  { key: "shop_insomniac", text: "不睡覺的", source: "shop", cost: 40_000 },
  { key: "shop_gold_slave", text: "金幣的奴隸", source: "shop", cost: 100_000 },
  { key: "shop_big_shot", text: "人稱大爺", source: "shop", cost: 250_000 },
  { key: "shop_richest", text: "本地最有錢的人", source: "shop", cost: 1_000_000 },
];

/** 成就附贈的稱號不另外存一份定義，直接從成就清單推出來 */
export const ACHIEVEMENT_TITLES: readonly TitleDefinition[] = ACHIEVEMENTS.map((a) => ({
  key: a.key,
  text: a.title,
  source: "achievement" as const,
}));

export const TITLES: readonly TitleDefinition[] = [...ACHIEVEMENT_TITLES, ...TITLE_SHOP];

export function findTitle(key: string | null | undefined): TitleDefinition | undefined {
  if (!key) return undefined;
  return TITLES.find((t) => t.key === key);
}

/** 稱號在資料卡上要顯示的文字。認不出來的 key 回 null，卡片就當作沒掛稱號 */
export function titleText(key: string | null | undefined): string | null {
  return findTitle(key)?.text ?? null;
}

// ── 顯示用 ──────────────────────────────────────────────────

export const BONUS_LABELS: Record<keyof AchievementBonus, string> = {
  attack: "攻擊力",
  defense: "防禦力",
  maxHealth: "生命上限",
  critRate: "爆擊率",
  dodgeRate: "閃避率",
};

/** 爆擊率/閃避率是百分比型，後面要帶 %（跟 Item.effectType 的分類一致） */
const PERCENT_STATS: readonly (keyof AchievementBonus)[] = ["critRate", "dodgeRate"];

/** 把一份加成寫成「攻擊力 +10」這種人看得懂的樣子。0 的項目不列 */
export function formatBonus(bonus: Partial<AchievementBonus>): string {
  const parts = (Object.keys(BONUS_LABELS) as (keyof AchievementBonus)[])
    .filter((stat) => (bonus[stat] ?? 0) !== 0)
    .map(
      (stat) => `${BONUS_LABELS[stat]} +${bonus[stat]}${PERCENT_STATS.includes(stat) ? "%" : ""}`
    );
  return parts.join("、");
}
