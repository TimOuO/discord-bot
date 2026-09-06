/**
 * 地下城「一趟下潛」的純規則：逐層敵人、獎勵曲線、材料里程碑、存活率估算。
 * 跟 combat.ts 一樣不碰資料庫，所以可以直接測、也可以拿去跑模擬。
 *
 * 為什麼是這個形狀（2026-09-06 的模擬結論，詳見 PRD 第 22 節）：
 * 舊版是「一次指令連打 4 層」，難度實測是階梯函數而不是曲線——Lv76 玩家在敵人 Lv100 時
 * 100% 獲勝、Lv110 時 0% 獲勝。結果鯨魚每 5 分鐘零風險領 2 件材料，新手則是 0% 全破直接撞牆。
 */
import { simulateCombat, rollEnemy, type EnemyEncounter } from "./combat";
import type { EffectiveStats } from "./itemService";
import { randomInt, randomChance } from "../utils/random";

const ENEMY_TYPES = ["哥布林", "史萊姆", "骷髏戰士", "狼人", "山賊", "食人魔", "惡靈", "巨蜥"];
const DEEP_ENEMY_TYPES = ["地城領主", "遠古巨龍", "深淵魔王", "屍骨君王", "熔岩巨人", "暗影統領"];
/** 這一層（含）以上換成比較唬人的名字，純粹是氣氛，不影響數值 */
const DEEP_NAME_FROM_FLOOR = 5;

/** 每往下一層，敵人等級加多少。維持舊版的坡度——曲線是靠「層間不回血」造出來的，不是靠坡度 */
export const ENEMY_LEVEL_PER_FLOOR = 2;

/**
 * 每層的等級隨機偏移幅度。這是整個機制唯一真正的不確定性來源：
 * 它每層只擲一次，不會像逐回合的傷害浮動那樣被回合數平均掉
 * （實測 ±40% 的傷害浮動只把深度標準差從 0.30 推到 0.55，幾乎沒有作用）。
 */
export const ENEMY_LEVEL_SPREAD = 6;

/** 抽到詞綴的機率，以及每種詞綴各佔一半 */
const AFFIX_CHANCE = 0.34;
const AFFIX_BERSERK_ATTACK_MULTIPLIER = 1.5;
const AFFIX_TOUGH_HEALTH_MULTIPLIER = 1.6;

export type DungeonAffix = "berserk" | "tough";

export const AFFIX_LABELS: Record<DungeonAffix, string> = {
  berserk: "狂暴",
  tough: "堅韌",
};

export const AFFIX_DESCRIPTIONS: Record<DungeonAffix, string> = {
  berserk: "攻擊力 ×1.5",
  tough: "生命值 ×1.6",
};

/**
 * 每層獎勵的成長倍率。這個數字是推導出來的，不是挑順眼的：
 * 決策要平衡（推的期望值 ≈ 收手），需要「下一層的獎勵 ≈ 已累積 × (1-p)/p」，
 * 存活率 p=60% 時反推大約是每層 ×1.67。但 ×1.67 讓一趟總產出變成 ×1.4 的三倍，
 * 會直接灌爆剛建立的強化材料沖水槽——×1.4 的張力一樣（第 9 層推 EV 2,949 對收手 3,439），
 * 產出卻只有三分之一。
 */
export const REWARD_GROWTH_PER_FLOOR = 1.4;

/** 第一層的基準金幣，之後照 REWARD_GROWTH_PER_FLOOR 成長 */
const BASE_FLOOR_GOLD = 40;
/** 經驗的基準；經驗不受「失敗沒收」影響，所以不用跟金幣同一條陡曲線 */
const BASE_FLOOR_XP = 25;

/**
 * 每幾層給一件稀有材料。舊版是「第 1 層 + boss 層」共 2 件、每 5 分鐘穩拿，
 * 鯨魚一趟約 9 層，每 4 層一件剛好也是 2 件——這次改的是「要不要賭」，不是「產量多少」，
 * 一次只動一個變因。深層才有的第 3 件自然成為往下衝的誘因。
 */
export const MATERIAL_EVERY_N_FLOORS = 4;

/**
 * 第一件材料落在第幾層。刻意不是第 4 層：模擬顯示新手只走得到第 1~2 層，
 * 里程碑放在 4 的話新手一件都拿不到——而舊版「第 1 層打贏就給一件」是給的，
 * 那會變成這次改動對新手的回歸。放在第 2 層，新手要賭一次才拿得到，
 * 剛好也是他人生第一個真正的推運氣決策；鯨魚則穩拿第 2、6 層兩件，維持改版前的產量。
 */
const MATERIAL_FIRST_FLOOR = 2;

/** 存活率高於這個門檻就自動下潛，不打擾玩家。跌破才停下來問——每一次問都要是真的取捨 */
export const AUTO_DESCEND_SURVIVAL_THRESHOLD = 0.9;

/** 估算存活率時跑幾次模擬。戰鬥本身很便宜，這個成本微不足道 */
const SURVIVAL_SAMPLE_SIZE = 500;

/** 防呆用的硬上限，正常玩家遠遠到不了（實測神話裝 Lv76 約 10 層） */
export const MAX_DUNGEON_FLOOR = 50;

/** 第 N 層的敵人等級。offset 讓呼叫端可以注入偏移，測試時傳 0 就測得到坡度本身 */
export function dungeonEnemyLevel(userLevel: number, floor: number, offset: number): number {
  return Math.max(1, userLevel - 2 + (floor - 1) * ENEMY_LEVEL_PER_FLOOR + offset);
}

/** 第 N 層的基準金幣獎勵 */
export function floorReward(floor: number): number {
  return Math.round(BASE_FLOOR_GOLD * Math.pow(REWARD_GROWTH_PER_FLOOR, floor - 1));
}

/** 第 N 層的經驗獎勵 */
export function floorXp(floor: number): number {
  return Math.round(BASE_FLOOR_XP * (1 + (floor - 1) * 0.5));
}

/** 這一層給不給材料 */
export function materialFloor(floor: number): boolean {
  return floor % MATERIAL_EVERY_N_FLOORS === MATERIAL_FIRST_FLOOR % MATERIAL_EVERY_N_FLOORS;
}

/**
 * 帶著現在的血量打這一層，活下來的機率。
 *
 * 直接跑模擬而不是套公式：戰鬥有爆擊、閃避、逐回合的傷害浮動，寫成封閉解會失真，
 * 而玩家要看著這個數字下注，失真是不能接受的。
 */
export function estimateSurvival(
  stats: EffectiveStats,
  enemy: EnemyEncounter,
  currentHealth: number
): number {
  let wins = 0;
  for (let i = 0; i < SURVIVAL_SAMPLE_SIZE; i++) {
    if (simulateCombat(stats, enemy, currentHealth).result === "win") wins++;
  }
  return wins / SURVIVAL_SAMPLE_SIZE;
}

export interface DungeonFloorPlan {
  floor: number;
  enemy: EnemyEncounter;
  affix: DungeonAffix | null;
  goldReward: number;
  xpReward: number;
  givesMaterial: boolean;
}

/**
 * 擲出第 N 層的內容。擲完會存進 DungeonRun，玩家看到的存活率跟他真正要打的那一層是同一個——
 * 不會出現「顯示 60%、按下去卻換成另一隻怪」。
 */
export function rollDungeonFloor(userLevel: number, floor: number): DungeonFloorPlan {
  const offset = randomInt(-ENEMY_LEVEL_SPREAD, ENEMY_LEVEL_SPREAD + 1);
  const level = dungeonEnemyLevel(userLevel, floor, offset);
  const namePool = floor >= DEEP_NAME_FROM_FLOOR ? DEEP_ENEMY_TYPES : ENEMY_TYPES;
  const enemy = rollEnemy(level, namePool);

  let affix: DungeonAffix | null = null;
  if (randomChance(AFFIX_CHANCE)) {
    affix = randomChance(0.5) ? "berserk" : "tough";
    if (affix === "berserk") {
      enemy.attack = Math.round(enemy.attack * AFFIX_BERSERK_ATTACK_MULTIPLIER);
    } else {
      enemy.health = Math.round(enemy.health * AFFIX_TOUGH_HEALTH_MULTIPLIER);
    }
  }

  return {
    floor,
    enemy,
    affix,
    goldReward: floorReward(floor),
    xpReward: floorXp(floor),
    givesMaterial: materialFloor(floor),
  };
}
