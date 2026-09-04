// 戰鬥/成長的「純規則」：不碰資料庫、不做任何 I/O，同樣的輸入永遠得到同樣分布的輸出。
// 從 rpgService 抽出來的目的有兩個：
// 1. scripts/simBalance.ts 要能直接 import 這些公式跑平衡模擬。留在 rpgService 的話，
//    光是 import 就會因為 dbService 在模組載入時 new PrismaClient 而需要 DATABASE_URL。
// 2. 調數值的時候，所有可調參數集中在同一個檔案裡，不用在近千行的 service 裡東翻西找。
import { randomInt, randomPercentChance } from "../utils/random";
import type { EffectiveStats } from "./itemService";

// ── 傷害公式 ────────────────────────────────────────────────
// 防禦 100 減傷 50%（200 減傷 66%，以此類推），只會「減傷」不會「完全免疫」；
// 舊公式是直接相減（傷害=攻擊-防禦），防禦一旦超過攻擊就會被保底傷害卡死在 1，
// 裝備越堆越強反而讓戰鬥完全沒難度，改百分比減傷後不管數值再怎麼成長都不會出現這個問題
export const DEFENSE_MITIGATION_CONSTANT = 100;

export function calculateDamage(attack: number, defense: number): number {
  const mitigated = (attack * DEFENSE_MITIGATION_CONSTANT) / (DEFENSE_MITIGATION_CONSTANT + defense);
  return Math.max(1, Math.round(mitigated) + randomInt(-2, 3));
}

// ── 敵人 ────────────────────────────────────────────────────
export interface EnemyEncounter {
  name: string;
  level: number;
  health: number;
  attack: number;
  defense: number;
}

export function rollEnemy(level: number, namePool: string[]): EnemyEncounter {
  return {
    name: namePool[randomInt(0, namePool.length)],
    level,
    health: 80 + level * 10,
    attack: 8 + level * 2,
    defense: 4 + level,
  };
}

// 一般戰鬥的敵人等級擲骰。基準是「玩家等級 -1」，再加上一個隨機偏移：
// Lv6+ 偏移是 {-1,0,1,2}（平均 +0.5，所以敵人平均落在玩家等級 -0.5），
// Lv5 以下偏移是 {-2,-1,0,1}，敵人不會超過玩家等級——新手保護，避免剛開始玩、
// 還沒有任何裝備時運氣不好抽到更強的敵人就直接落敗（百分比減傷公式沒有舊公式那麼寬容）
export function rollEnemyLevel(userLevel: number): number {
  const variance = userLevel <= 5 ? randomInt(-2, 2) : randomInt(-1, 3);
  return Math.max(1, userLevel - 1 + variance);
}

// ── 單場戰鬥 ────────────────────────────────────────────────
// /rpg battle、/rpg dungeon 的每一層、菁英怪都共用同一套回合模擬
export function simulateCombat(
  effectiveStats: EffectiveStats,
  enemy: EnemyEncounter,
  startHealth: number
): { result: "win" | "lose"; finalHealth: number; rounds: number } {
  let userHealth = startHealth;
  let currentEnemyHealth = enemy.health;
  let rounds = 0;

  while (userHealth > 0 && currentEnemyHealth > 0) {
    rounds++;
    let userDamage = calculateDamage(effectiveStats.attack, enemy.defense);
    // 爆擊：裝備 critRate 加成的機率讓這回合傷害翻倍
    if (randomPercentChance(effectiveStats.critRate)) {
      userDamage *= 2;
    }
    currentEnemyHealth -= userDamage;

    if (currentEnemyHealth > 0) {
      // 閃避：裝備 dodgeRate 加成的機率讓這回合完全不受傷
      const dodged = randomPercentChance(effectiveStats.dodgeRate);
      if (!dodged) {
        const enemyDamage = calculateDamage(enemy.attack, effectiveStats.defense);
        userHealth -= enemyDamage;
      }
    }
  }

  return { result: userHealth > 0 ? "win" : "lose", finalHealth: userHealth, rounds };
}

// ── 戰鬥後的血量規則 ────────────────────────────────────────
// 打贏一場戰鬥回血的比例：改成百分比而不是固定 +10，
// 換成百分比減傷公式後每場戰鬥動輒損血幾十到上百點，固定 +10 早就變得聊勝於無
export const WIN_HEAL_RATIO = 0.15;

export function healOnWin(currentHealth: number, maxHealth: number): number {
  return Math.min(currentHealth + Math.round(maxHealth * WIN_HEAL_RATIO), maxHealth);
}

// 新手保護：Lv5 以下落敗只砍到上限的 80%，不是 30%。新手通常還沒買藥水、也不知道要去商店買，
// 同等級敵人每場都是滿血迎戰，玩家只要沒有回到接近滿血，下一場就會持續處於劣勢；
// 試過 60% 還是會連續輸好幾場爬不回來，80% 才能真的打破「血越少、越容易再輸、血更少」的死亡螺旋
// ——這個保護只影響落敗的血量下限，不影響戰鬥本身的勝率
export function lossHealthFloor(maxHealth: number, userLevel: number): number {
  const ratio = userLevel <= 5 ? 0.8 : 0.3;
  return Math.max(10, Math.floor(maxHealth * ratio));
}

// ── 等級成長 ────────────────────────────────────────────────
// 升到某等級需要的「累計」總經驗值，平方成長：等級越高，落差越大
// 舊公式是純線性（level*100），導致等級越高完全沒有變難，18 級只要 1800 經驗
export function xpThresholdForLevel(level: number): number {
  return 50 * level * level;
}

// 每升一級加多少屬性
export const LEVEL_UP_ATTACK_GAIN = 2;
export const LEVEL_UP_DEFENSE_GAIN = 1;
export const LEVEL_UP_MAX_HEALTH_GAIN = 10;

// 結構上跟 Prisma 的 UserUpdateInput 相容（可以直接展開進 data），但這裡刻意不 import
// Prisma 的型別，讓這個模組完全不知道持久層的存在
export interface LevelUpStatIncrements {
  level?: { increment: number };
  attack?: { increment: number };
  defense?: { increment: number };
  maxHealth?: { increment: number };
}

export interface LevelUpResult {
  newLevel: number;
  levelsGained: number;
  /** 升級後的有效生命上限；沒升級時就等於傳進來的 currentMaxHealth */
  newMaxHealth: number;
  /** 直接展開進 prisma.user.update 的 data 裡用；沒升級時是空物件 */
  statIncrements: LevelUpStatIncrements;
}

// 戰鬥勝、戰鬥敗、菁英怪、地下城四處結算都要跑同一套升級判定。
// 這裡只算「共通的部分」——跨了幾級、新的生命上限、要寫進資料庫的屬性增量；
// 血量最後要寫多少刻意不在這裡決定，因為四處的規則本來就不一樣（勝利補滿、落敗砍到下限、
// 地下城還要看有沒有全破），硬要一起抽只會變成一堆旗標參數
export function computeLevelUp(
  currentLevel: number,
  newXP: number,
  currentMaxHealth: number
): LevelUpResult {
  // 用迴圈處理一次獲得的經驗值就跨過多個等級門檻的情況
  let newLevel = currentLevel;
  while (newXP >= xpThresholdForLevel(newLevel)) {
    newLevel++;
  }
  const levelsGained = newLevel - currentLevel;

  return {
    newLevel,
    levelsGained,
    newMaxHealth: currentMaxHealth + levelsGained * LEVEL_UP_MAX_HEALTH_GAIN,
    statIncrements:
      levelsGained > 0
        ? {
            level: { increment: levelsGained },
            attack: { increment: levelsGained * LEVEL_UP_ATTACK_GAIN },
            defense: { increment: levelsGained * LEVEL_UP_DEFENSE_GAIN },
            maxHealth: { increment: levelsGained * LEVEL_UP_MAX_HEALTH_GAIN },
          }
        : {},
  };
}
