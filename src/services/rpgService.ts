import { Item, Prisma, User, DungeonRun } from "../generated/prisma";
import { randomInt, randomChance } from "../utils/random";
import { daysBetweenDateStrings, getLocalDateString, formatCooldown } from "../utils/datetime";
import { PlayerNotice } from "../utils/errors";
import prisma from "./dbService";
import { ItemService } from "./itemService";
import type { EffectiveStats } from "./itemService";
import { nextStepHint, NEW_PLAYER_HINT_MAX_LEVEL } from "./newPlayerHints";
import {
  computeLevelUp,
  healOnWin,
  lossHealthFloor,
  offlineRegen,
  rollEnemy,
  rollEnemyLevel,
  simulateCombat,
  xpThresholdForLevel,
} from "./combat";
import {
  AUTO_DESCEND_SURVIVAL_THRESHOLD,
  MAX_DUNGEON_FLOOR,
  estimateSurvival,
  rollDungeonFloor,
  type DungeonAffix,
  type DungeonFloorPlan,
} from "./dungeonRun";
import {
  gatherRollCount,
  harvestEmptyChanceOverride,
  isJobKey,
  maxBattleStreak,
  JOB_CHANGE_COST,
  JOB_UNLOCK_LEVEL,
  type JobKey,
} from "./jobs";

// 給指令層顯示「距離下一級還差多少經驗」用，實作在 combat.ts
export { xpThresholdForLevel };

export const BATTLE_COOLDOWN_MS = 30 * 1000;
/**
 * 血戰鬥神連戰結束之後的冷卻。刻意比 5 場 × 30 秒還短一點：
 * 連戰不是懲罰，換算下來是每小時 150 場（一般人 120 場）。
 * 但也不能維持 30 秒——那會讓材料水龍頭直接開 5 倍。
 */
export const BERSERKER_COOLDOWN_MS = 2 * 60 * 1000;
/** 連戰每往下一場，敵人加幾級 */
const BERSERKER_ENEMY_LEVEL_PER_FIGHT = 3;
export const DUNGEON_COOLDOWN_MS = 5 * 60 * 1000;
const DUNGEON_FLOOR_COUNT = 4;

const ENEMY_TYPES = ["哥布林", "史萊姆", "骷髏戰士", "狼人", "山賊", "食人魔", "惡靈", "巨蜥"];
const DUNGEON_BOSS_TYPES = ["地城領主", "遠古巨龍", "深淵魔王", "屍骨君王", "熔岩巨人", "暗影統領"];
const ELITE_ENEMY_TYPES = ["菁英哥布林王", "血眼狼王", "暗影刺客", "巨人守衛", "毒沼巫妖", "鋼鐵傀儡"];

// 打贏主戰鬥後，這兩個是各自獨立的骰子，都判斷過（可能同一場戰鬥兩個都中，也可能都沒中）
const BATTLE_LOOT_EVENT_CHANCE = 0.35;
const BATTLE_ELITE_EVENT_CHANCE = 0.2;

export const FISH_COOLDOWN_MS = 60 * 1000;
const EMPTY_CATCH_CHANCE = 0.05;
const EMPTY_CATCH_MESSAGES = [
  "魚餌被偷吃了，什麼都沒釣到...",
  "等了老半天，連個影子都沒有。",
  "魚線斷了！這次白忙一場。",
  "只釣到一隻舊靴子。",
];

export const GATHER_COOLDOWN_MS = 60 * 1000;
const GATHER_EMPTY_CHANCE = 0.05;
const GATHER_EMPTY_MESSAGES = [
  "找了半天什麼都沒找到...",
  "只挖到一堆土，白忙一場。",
  "工具滑手，這次沒採到東西。",
  "附近的資源被採光了，空手而歸。",
];

// 每個稀有度權重底下可以放多種名稱，抽中該稀有度後再從裡面隨機挑一個，
// 這樣同一個稀有度也能有多種花樣，不用每種稀有度都寫死只有一個名字
interface WeightedTier {
  weight: number;
  names: string[];
}

// 稀有度權重：數字越大越常見，總和不用是 100，pickFromWeightedTiers 會自己按比例抽
// 2026-09-03 調整：legendary 原本 1%（100 次採集/釣魚平均見一次）玩家反映太難掉，調到 3%；
// epic 原本比 legendary 常見 4 倍，若只調 legendary 兩者會差不到 1.4 倍、感覺不出階級落差，
// 所以 epic 也一起從 4 調到 8，維持接近的相對落差（約 2.7 倍）
const FISH_TABLE: WeightedTier[] = [
  { weight: 50, names: ["小魚乾", "泥鰍", "吳郭魚"] },
  { weight: 30, names: ["虹鱒", "鯖魚", "花枝"] },
  { weight: 15, names: ["銀鱗鮭", "龍虎斑", "紅魽"] },
  { weight: 8, names: ["深海鮟鱇魚", "電鰻", "小鯊魚"] },
  { weight: 3, names: ["黃金鯉魚", "傳說錦鯉", "神秘魚王"] },
];

const GATHER_TABLE: WeightedTier[] = [
  { weight: 50, names: ["樹枝", "石頭", "麻繩"] },
  { weight: 30, names: ["鐵礦", "煤炭", "硬木"] },
  { weight: 15, names: ["銀礦", "玉石", "陳年木材"] },
  { weight: 8, names: ["金礦", "藍水晶", "魔力碎片"] },
  { weight: 3, names: ["紫水晶", "星隕石", "遠古符文石"] },
];

function pickFromWeightedTiers(tiers: WeightedTier[]): string {
  const totalWeight = tiers.reduce((sum, tier) => sum + tier.weight, 0);
  let roll = randomInt(0, totalWeight);
  for (const tier of tiers) {
    if (roll < tier.weight) return tier.names[randomInt(0, tier.names.length)];
    roll -= tier.weight;
  }
  const lastTier = tiers[tiers.length - 1];
  return lastTier.names[randomInt(0, lastTier.names.length)];
}

export type BattleBonusEvent =
  | { type: "gold"; amount: number }
  | { type: "item"; item: Item; quantity: number; xpGained: number }
  | {
      type: "elite";
      enemyName: string;
      enemyLevel: number;
      result: "win" | "lose";
      rounds: number;
      xpGained: number;
      goldGained: number;
      rareLoot: RareLoot | null;
    };

export interface RareLoot {
  item: Item;
  quantity: number;
}

// 打贏菁英怪/地下城 boss 保證額外掉一件稀有材料，只從 rare/epic/legendary 三階抽（跳過 common/uncommon），
// 混合 FISH_TABLE/GATHER_TABLE，兩個表的稀有度順序一樣固定是 common/uncommon/rare/epic/legendary，
// slice(2) 就是拿掉前兩階只留 rare 以上
export async function pickRareLootItem(): Promise<Item | null> {
  const table = randomChance(0.5) ? FISH_TABLE : GATHER_TABLE;
  const lootName = pickFromWeightedTiers(table.slice(2));
  return ItemService.findItemByName(lootName);
}

async function grantRareLoot(userId: string): Promise<RareLoot | null> {
  const item = await pickRareLootItem();
  if (!item) return null;

  const inventory = await prisma.inventory.upsert({
    where: { userId_itemId: { userId, itemId: item.id } },
    create: { userId, itemId: item.id, quantity: 1 },
    update: { quantity: { increment: 1 } },
  });
  return { item, quantity: inventory.quantity };
}

// 打贏主戰鬥後才會擲這兩個獨立的骰子（35% 金幣/道具、20% 菁英怪，互不影響，可能同時中）；
// 菁英怪對打一場用跟主戰鬥、地下城一樣的 simulateCombat()，輸了一樣會把血量砍到有效上限的 30%，
// 是真的有風險的額外戰鬥，不是穩賺不賠的獎勵
async function rollBattleBonusEvent(
  user: User,
  effectiveStats: EffectiveStats,
  currentHealth: number,
  // 血戰鬥神連戰的最後一場：整趟還沒遇到菁英怪的話，這場強制出現（「保證遭遇一次」的兜底）
  forceElite = false
): Promise<{
  events: BattleBonusEvent[];
  xpGained: number;
  goldGained: number;
  finalHealth: number;
  eliteAppeared: boolean;
}> {
  const events: BattleBonusEvent[] = [];
  let xpGained = 0;
  let goldGained = 0;
  let finalHealth = currentHealth;

  if (randomChance(BATTLE_LOOT_EVENT_CHANCE)) {
    if (randomChance(0.5)) {
      const amount = Math.round((20 + user.level * 5 + randomInt(0, 10)) * (1 + effectiveStats.goldBonus / 100));
      goldGained += amount;
      events.push({ type: "gold", amount });
    } else {
      const lootName =
        randomChance(0.5) ? pickFromWeightedTiers(FISH_TABLE) : pickFromWeightedTiers(GATHER_TABLE);
      const item = await ItemService.findItemByName(lootName);
      if (item) {
        const itemXpGained = Math.round(randomInt(2, 6) * (1 + effectiveStats.xpBonus / 100));
        xpGained += itemXpGained;
        const inventory = await prisma.inventory.upsert({
          where: { userId_itemId: { userId: user.id, itemId: item.id } },
          create: { userId: user.id, itemId: item.id, quantity: 1 },
          update: { quantity: { increment: 1 } },
        });
        events.push({ type: "item", item, quantity: inventory.quantity, xpGained: itemXpGained });
      }
    }
  }

  const eliteAppeared = forceElite || randomChance(BATTLE_ELITE_EVENT_CHANCE);
  if (eliteAppeared) {
    const eliteLevel = Math.max(1, user.level + 2 + randomInt(0, 3));
    const enemy = rollEnemy(eliteLevel, ELITE_ENEMY_TYPES);
    // 菁英怪比一般敵人明顯更強，不是隨便就能打贏的額外戰鬥
    enemy.health = Math.round(enemy.health * 2.0);
    enemy.attack = Math.round(enemy.attack * 1.5);

    const combat = simulateCombat(effectiveStats, enemy, finalHealth);
    let eliteXpGained: number;
    let eliteGoldGained = 0;
    let rareLoot: RareLoot | null = null;
    if (combat.result === "win") {
      eliteXpGained = Math.round((20 + enemy.level * 6 + randomInt(1, 8)) * (1 + effectiveStats.xpBonus / 100));
      eliteGoldGained = Math.round((15 + enemy.level * 3 + randomInt(0, 8)) * (1 + effectiveStats.goldBonus / 100));
      finalHealth = healOnWin(combat.finalHealth, effectiveStats.maxHealth);
      rareLoot = await grantRareLoot(user.id);
    } else {
      eliteXpGained = Math.max(1, Math.round(enemy.level * 2 * (1 + effectiveStats.xpBonus / 100)));
      finalHealth = Math.max(10, Math.floor(effectiveStats.maxHealth * 0.3));
    }

    xpGained += eliteXpGained;
    goldGained += eliteGoldGained;
    events.push({
      type: "elite",
      enemyName: enemy.name,
      enemyLevel: enemy.level,
      result: combat.result,
      rounds: combat.rounds,
      xpGained: eliteXpGained,
      goldGained: eliteGoldGained,
      rareLoot,
    });
  }

  return { events, xpGained, goldGained, finalHealth, eliteAppeared };
}


/**
 * 抽 rollCount 份收穫並寫進背包，回傳每一份是什麼。
 *
 * 荒野獵者是「擲兩次獨立的骰子」而不是「同一份拿兩個」——期望值一樣，
 * 但抽中傳說的機率從 2.7% 變成 5.3%，玩家感受到的是「多久遇到一次好東西」而不是期望值。
 */
async function harvest(
  userInternalId: string,
  table: WeightedTier[],
  rollCount: number,
  seedScript: string
): Promise<HarvestEntry[]> {
  const entries: HarvestEntry[] = [];
  for (let i = 0; i < rollCount; i++) {
    const name = pickFromWeightedTiers(table);
    const item = await ItemService.findItemByName(name);
    if (!item) {
      throw new Error(`資料「${name}」尚未建立，請先執行種子腳本 ${seedScript}`);
    }
    const inventory = await prisma.inventory.upsert({
      where: { userId_itemId: { userId: userInternalId, itemId: item.id } },
      create: { userId: userInternalId, itemId: item.id, quantity: 1 },
      update: { quantity: { increment: 1 } },
    });
    entries.push({ item, quantity: inventory.quantity });
  }
  return entries;
}

// 連續簽到獎勵：每連續一天加基礎金幣的 2%，最多加到 +60%（連續 30 天封頂）
const STREAK_BONUS_PER_DAY = 0.02;
const STREAK_BONUS_MAX_DAYS = 30;
// 漏簽幾天以內還算在寬限期（2 代表「昨天沒簽、但前天有簽」還救得回來）
const STREAK_GRACE_GAP_DAYS = 2;

// 每日重置的邊界是台北時間 00:00，固定用 +08:00 換算，跟主機所在時區無關
function getNextResetTime(date: Date): Date {
  const todayStr = getLocalDateString(date);
  const next = new Date(`${todayStr}T00:00:00+08:00`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** 資料庫裡那一列進行中的下潛 */
type DungeonRunRow = DungeonRun;

/** 未入袋的材料。戰敗會全部沒收，所以在帶著離開之前不會真的進背包 */
export interface PendingLoot {
  itemId: string;
  name: string;
  quantity: number;
}

/** 這次呼叫裡自動打過的每一層，給卡片摘要用 */
export interface DungeonClearedFloor {
  floor: number;
  enemyName: string;
  enemyLevel: number;
  affix: DungeonAffix | null;
  goldReward: number;
  xpReward: number;
  materialName: string | null;
  healthAfter: number;
  rounds: number;
}


export type ChooseJobResult =
  | { status: "not_started" }
  | { status: "level_too_low"; currentLevel: number; requiredLevel: number }
  | { status: "already_that_job" }
  | { status: "not_enough_gold"; cost: number; gold: number }
  | { status: "changed"; job: JobKey; previousJob: JobKey | null; cost: number; goldAfter: number };

export type DungeonEnterResult =
  | { status: "not_started" }
  | { status: "cooldown"; remainingSeconds: number }
  | {
      status: "at_decision";
      clearedFloors: number;
      health: number;
      maxHealth: number;
      goldPending: number;
      xpPending: number;
      lootPending: PendingLoot[];
      /** 已經擲好的下一層：玩家看到的存活率跟他真正要打的那層是同一個 */
      nextFloor: DungeonFloorPlan;
      survival: number;
      autoCleared: DungeonClearedFloor[];
    }
  | {
      status: "died";
      clearedFloors: number;
      deathFloor: DungeonFloorPlan;
      /** 經驗不沒收 */
      xpGained: number;
      goldForfeited: number;
      lootForfeited: PendingLoot[];
      autoCleared: DungeonClearedFloor[];
    };

export type DungeonDescendResult = DungeonEnterResult | { status: "no_run" };

export type DungeonLeaveResult =
  | { status: "not_started" }
  | { status: "no_run" }
  | {
      status: "left";
      clearedFloors: number;
      goldGained: number;
      xpGained: number;
      loot: PendingLoot[];
      user: User;
    };

/** 一次釣魚/採集抽到的一份收穫。荒野獵者一次會抽兩份（可能是不同的東西） */
export interface HarvestEntry {
  item: Item;
  /** 收進背包之後這個道具總共有幾個 */
  quantity: number;
}

export type FishResult =
  | { status: "not_started" }
  | { status: "cooldown"; remainingSeconds: number }
  | { status: "empty"; message: string }
  | { status: "caught"; items: HarvestEntry[]; xpGained: number };

export type GatherResult =
  | { status: "not_started" }
  | { status: "cooldown"; remainingSeconds: number }
  | { status: "empty"; message: string }
  | { status: "gathered"; items: HarvestEntry[]; xpGained: number };

export type DailyClaimResult =
  | { status: "not_started" }
  | { status: "already_claimed"; remainingHours: number; remainingMinutes: number }
  | {
      status: "claimed";
      goldReward: number;
      streakBonus: number;
      /** 連續獎勵的加成比例（百分比，例如連續 10 天就是 20），給卡片顯示「為什麼是這個數字」用 */
      streakBonusPercent: number;
      finalGoldReward: number;
      xpReward: number;
      streak: number;
      updatedUser: User;
      effectiveMaxHealth: number;
    };

export class RPGService {
  /**
   * 結算離線回血，回傳結算後的血量與這次回了多少。
   *
   * 血量真正重要的入口（戰鬥、地下城進場、角色資料、背包、簽到、吃藥）先呼叫這個再往下做。
   * 因為結果會寫回資料庫，漏掛一兩個入口不會造成不一致——下一個指令會自己補上。
   *
   * 回血量算出來是 0 的時候**不會推進 lastHealthTick**：上限 120 的新手每小時只回 10 點，
   * 每兩分鐘下一個指令就是 0.35 點，照樣推進時鐘的話他永遠不會回血。
   */
  static async applyOfflineRegen(
    userInternalId: string
  ): Promise<{ health: number; healed: number }> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userInternalId } });

    // 既有玩家沒有時間戳：設成當下開始算，不追溯發放
    if (!user.lastHealthTick) {
      await prisma.user.update({
        where: { id: userInternalId },
        data: { lastHealthTick: new Date() },
      });
      return { health: user.health, healed: 0 };
    }

    const effectiveStats = await ItemService.getEffectiveStats(userInternalId, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });

    const elapsedMs = Date.now() - user.lastHealthTick.getTime();
    const healed = offlineRegen(user.health, effectiveStats.maxHealth, elapsedMs);
    if (healed <= 0) {
      return { health: user.health, healed: 0 };
    }

    // 條件帶上「血量還是我們讀到的那個值」，同時進來兩個指令不會各回一次
    const applied = await prisma.user.updateMany({
      where: { id: userInternalId, health: user.health },
      data: { health: user.health + healed, lastHealthTick: new Date() },
    });
    if (applied.count === 0) {
      const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userInternalId } });
      return { health: fresh.health, healed: 0 };
    }

    return { health: user.health + healed, healed };
  }

  /**
   * 選擇或變更職業。第一次免費，之後每次收 JOB_CHANGE_COST。
   *
   * 「扣款 + 換職業」包在同一個 conditional update 裡：where 帶上「職業還是我們讀到的那個、
   * 而且錢還夠」，兩個併發請求只有一個會命中，不會被扣兩次錢。
   */
  static async chooseJob(discordUserId: string, job: JobKey): Promise<ChooseJobResult> {
    const user = await prisma.user.findUnique({ where: { userId: discordUserId } });
    if (!user) return { status: "not_started" };

    if (user.level < JOB_UNLOCK_LEVEL) {
      return { status: "level_too_low", currentLevel: user.level, requiredLevel: JOB_UNLOCK_LEVEL };
    }

    const currentJob = isJobKey(user.job) ? user.job : null;
    // 選一樣的擋下來：不然玩家會白白付一次變更費用換到同一個職業
    if (currentJob === job) return { status: "already_that_job" };

    const cost = user.jobChangedOnce ? JOB_CHANGE_COST : 0;
    if (user.gold < cost) return { status: "not_enough_gold", cost, gold: user.gold };

    const claimed = await prisma.user.updateMany({
      where: {
        id: user.id,
        job: user.job,
        jobChangedOnce: user.jobChangedOnce,
        gold: { gte: cost },
      },
      data: {
        job,
        jobChangedOnce: true,
        gold: { decrement: cost },
        // 連戰狀態必須跟著清掉：連戰中途換成別的職業的話，battleStreak 會停在 >0
        // 但上限變回 1，兩條路徑都進不去（搶冷卻那條的 where 要求 battleStreak: 0），
        // 玩家會被永久鎖住打不了架
        battleStreak: 0,
        streakEliteFired: false,
      },
    });
    if (claimed.count === 0) {
      throw new PlayerNotice("職業剛剛被另一個操作改變了，請重新查看目前狀態");
    }

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return { status: "changed", job, previousJob: currentJob, cost, goldAfter: updated.gold };
  }

  static async findUserByDiscordId(userId: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { userId } });
  }

  /**
   * 新手的「下一步」提示，沒事可提醒（或已經不是新手）就回傳 null。
   * 規則本身在 newPlayerHints.ts，這裡只負責把它要看的狀態查齊。
   */
  static async getNextStepHint(discordUserId: string): Promise<string | null> {
    const user = await this.findUserByDiscordId(discordUserId);
    if (!user) return null;
    // 等級先擋掉，老手就不用白跑下面那三個查詢了
    if (user.level >= NEW_PLAYER_HINT_MAX_LEVEL) return null;

    const [effectiveStats, inventory, affordableUpgrade] = await Promise.all([
      ItemService.getEffectiveStats(user.id, {
        attack: user.attack,
        defense: user.defense,
        maxHealth: user.maxHealth,
      }),
      ItemService.getInventory(user.id),
      ItemService.findAffordableUpgrade(user.id, user.gold),
    ]);

    return nextStepHint({
      level: user.level,
      health: user.health,
      maxHealth: effectiveStats.maxHealth,
      gold: user.gold,
      hasHealingPotion: inventory.some(
        (entry) => entry.kind === "stack" && entry.item.effectType === "heal" && entry.quantity > 0
      ),
      hasGathered: inventory.some(
        (entry) =>
          entry.kind === "stack" && (entry.item.type === "fish" || entry.item.type === "material")
      ),
      lastBattleAt: user.lastBattle,
      affordableUpgrade,
    });
  }

  static async getOrCreateUser(
    userId: string,
    username: string
  ): Promise<User> {
    let user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          userId,
          username,
        },
      });
    }

    return user;
  }

  // 排名依等級高低，等級相同時比經驗值；2 人小型伺服器不需要更複雜的多分類排行榜
  static async getLeaderboard(limit = 10): Promise<User[]> {
    return prisma.user.findMany({
      orderBy: [{ level: "desc" }, { xp: "desc" }],
      take: limit,
    });
  }

  // 只有 /rpg start 會呼叫（character.ts 已經先擋掉「帳號已經存在」的情況），
  // 所以這裡不用另外判斷是不是新帳號，每次呼叫都可以放心送新手背包
  static async startRPG(userId: string, username: string): Promise<User> {
    const user = await this.getOrCreateUser(userId, username);
    await this.grantStarterKit(user.id);
    return user;
  }

  // 新手背包：3 瓶小型生命藥水讓新手能自己回血、不用完全依賴戰鬥的血量保底機制；
  // 基本武器/防具直接裝上，讓新手一開始就有一點點屬性優勢，不用先攢錢逛商店才有東西可用
  private static async grantStarterKit(userInternalId: string): Promise<void> {
    const potion = await ItemService.findItemByName("小型生命藥水");
    if (potion) {
      await prisma.inventory.upsert({
        where: { userId_itemId: { userId: userInternalId, itemId: potion.id } },
        create: { userId: userInternalId, itemId: potion.id, quantity: 3 },
        update: { quantity: { increment: 3 } },
      });
    }

    // 武器/防具是裝備，要建成實體（一件一列）而不是可堆疊的庫存列
    for (const name of ["木劍", "皮革護甲"]) {
      const gear = await ItemService.findItemByName(name);
      if (!gear) continue;

      const instance = await prisma.itemInstance.create({
        data: { userId: userInternalId, itemId: gear.id },
      });
      await ItemService.equipItem(userInternalId, instance.id);
    }
  }

  static async battle(userId: string): Promise<{
    user: User;
    enemyName: string;
    enemyLevel: number;
    enemyHealth: number;
    result: "win" | "lose";
    xpGained: number;
    goldGained: number;
    healthDelta: number;
    rounds: number;
    effectiveMaxHealth: number;
    message: string;
    bonusEvents: BattleBonusEvent[];
    bonusLevelsGained: number;
    /** 這一場打完之後的連戰場次（0 = 沒有進行中的連戰） */
    battleStreak: number;
    /** 這個職業一次冷卻內最多能打幾場（1 = 沒有連戰） */
    streakLimit: number;
  }> {
    let user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      throw new PlayerNotice("使用者不存在，請先使用 /rpg start 指令開始遊戲");
    }

    // 昨天輸完就下線的人，今天第一場不該還帶著殘血進場
    const regen = await this.applyOfflineRegen(user.id);
    if (regen.healed > 0) {
      user = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    }

    const job = isJobKey(user.job) ? user.job : null;
    const streakLimit = maxBattleStreak(job);
    // 連戰進行中（贏了但還沒連滿）就不用等冷卻，那正是血戰鬥神的被動
    const continuingStreak = user.battleStreak > 0 && user.battleStreak < streakLimit;
    const cooldownMs = streakLimit > 1 ? BERSERKER_COOLDOWN_MS : BATTLE_COOLDOWN_MS;

    if (!continuingStreak) {
      // 先搶冷卻再算戰鬥：where 直接帶「還沒打過或已經過冷卻」的條件，count 是 0 就代表被搶輸了，
      // 不會有兩個併發請求都通過「讀出來的 lastBattle 還沒過期」檢查、都跑完戰鬥的競態。
      // 連戰的第一場也要搶，之後幾場靠 battleStreak 的 conditional update 擋重複
      const battleCutoff = new Date(Date.now() - cooldownMs);
      const claimedBattle = await prisma.user.updateMany({
        where: {
          id: user.id,
          battleStreak: 0,
          OR: [{ lastBattle: null }, { lastBattle: { lt: battleCutoff } }],
        },
        data: { lastBattle: new Date() },
      });
      if (claimedBattle.count === 0) {
        const remainingTime = Math.ceil(
          (cooldownMs - (Date.now() - new Date(user.lastBattle!).getTime())) / 1000
        );
        throw new PlayerNotice(`⏳ 戰鬥冷卻中，還要等 ${formatCooldown(remainingTime * 1000)}。`);
      }
    } else {
      // 連戰的第 2 場之後：用「連戰場次還是我們讀到的那個」把連點兩下擋掉
      const claimedFight = await prisma.user.updateMany({
        where: { id: user.id, battleStreak: user.battleStreak },
        data: { battleStreak: { increment: 0 } },
      });
      if (claimedFight.count === 0) {
        throw new PlayerNotice("這一場剛剛已經打過了，請重新查看目前狀態");
      }
    }

    // 有效屬性 = 基礎屬性 + 目前裝備加成，戰鬥傷害要用有效屬性計算，裝備才會真正影響戰鬥
    const effectiveStats = await ItemService.getEffectiveStats(user.id, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });

    // 連戰越打越深：每一場敵人 +3 級，所以連戰不是無限的免費場次
    const streakBonusLevel = user.battleStreak * BERSERKER_ENEMY_LEVEL_PER_FIGHT;
    const enemy = rollEnemy(rollEnemyLevel(user.level) + streakBonusLevel, ENEMY_TYPES);
    const enemyName = enemy.name;
    const enemyLevel = enemy.level;
    const enemyHealth = enemy.health;

    const { result, finalHealth: userHealth, rounds } = simulateCombat(effectiveStats, enemy, user.health);

    let xpGained = 0;
    let goldGained = 0;
    let message = "";
    // 裝備不會在戰鬥中途變動，所以升級前後的差別只在「基礎值」，這裡先預設沒升級時的有效上限，
    // win 分支升級時會再蓋成 newMaxHealth（已經把等級加成算進去的有效值）
    let effectiveMaxHealth = effectiveStats.maxHealth;

    if (result === "win") {
      xpGained = Math.round((10 + enemyLevel * 5 + randomInt(1, 6)) * (1 + effectiveStats.xpBonus / 100));
      goldGained = Math.round((5 + enemyLevel * 2 + randomInt(0, 5)) * (1 + effectiveStats.goldBonus / 100));

      const { newLevel, levelsGained, newMaxHealth, statIncrements } = computeLevelUp(
        user.level,
        user.xp + xpGained,
        effectiveStats.maxHealth
      );
      effectiveMaxHealth = newMaxHealth;

      message =
        levelsGained > 0
          ? `恭喜！你擊敗了 ${enemyName}，獲得了 ${xpGained} 經驗值和 ${goldGained} 金幣，並且升級到了 ${newLevel} 級！`
          : `你擊敗了 ${enemyName}，獲得了 ${xpGained} 經驗值和 ${goldGained} 金幣！`;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          xp: { increment: xpGained },
          gold: { increment: goldGained },
          ...statIncrements,
          // health 取決於這場戰鬥模擬出的結果，不是相對資料庫舊值的增減，所以維持絕對值寫入
          // 升級的話直接補滿；沒升級才維持原本「贏了回一點血」的規則
          health: levelsGained > 0 ? newMaxHealth : healOnWin(userHealth, newMaxHealth),
        },
      });
    } else {
      xpGained = Math.max(1, Math.round(enemyLevel * 2 * (1 + effectiveStats.xpBonus / 100)));
      message = `你被 ${enemyName} 擊敗了，獲得了 ${xpGained} 點經驗值作為安慰。休息一下再來挑戰吧！`;

      // 落敗的安慰經驗值也可能跨過升級門檻，等級/屬性要照樣升，不然經驗值會卡在超過門檻卻不升級的爆表狀態；
      // 但血量仍然要照落敗懲罰砍到（新）上限的 30%，不能因為剛好升級就用全滿血蓋掉這次的敗北
      const { newMaxHealth: newMaxHealthOnLoss, statIncrements } = computeLevelUp(
        user.level,
        user.xp + xpGained,
        effectiveStats.maxHealth
      );
      effectiveMaxHealth = newMaxHealthOnLoss;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          xp: { increment: xpGained },
          ...statIncrements,
          health: lossHealthFloor(newMaxHealthOnLoss, user.level),
        },
      });
    }

    const updatedUser = (await prisma.user.findUnique({
      where: { userId },
    })) as User;

    // 打贏才有資格額外擲「金幣/道具」「菁英怪」兩個獨立事件；跟主戰鬥完全分開結算，
    // 主戰鬥的數值/測試都不受影響，這邊只是額外疊加上去的第二階段
    let bonusEvents: BattleBonusEvent[] = [];
    let finalUser = updatedUser;
    let finalEffectiveMaxHealth = effectiveMaxHealth;
    let bonusLevelsGained = 0;
    let eliteAppearedThisFight = false;

    if (result === "win") {
      const postBattleStats = await ItemService.getEffectiveStats(updatedUser.id, {
        attack: updatedUser.attack,
        defense: updatedUser.defense,
        maxHealth: updatedUser.maxHealth,
      });
      // 連戰的最後一場而且整趟都還沒遇到菁英怪 → 強制出現，這是「保證遭遇一次」的兜底。
      // 平常的 20% 擲骰照舊，所以一趟可能不只一隻
      const isFinalStreakFight = streakLimit > 1 && user.battleStreak + 1 >= streakLimit;
      const forceElite = isFinalStreakFight && !user.streakEliteFired;
      const bonus = await rollBattleBonusEvent(
        updatedUser,
        postBattleStats,
        updatedUser.health,
        forceElite
      );
      eliteAppearedThisFight = bonus.eliteAppeared;

      if (bonus.events.length > 0) {
        bonusEvents = bonus.events;

        const eliteEvent = bonus.events.find((event) => event.type === "elite");
        const eliteLost = eliteEvent?.type === "elite" && eliteEvent.result === "lose";

        if (eliteLost) {
          // 菁英怪輸了：跟主戰鬥落敗一樣不觸發升級，經驗值只計入累積，之後靠贏別場戰鬥再一次補上；
          // 這樣才不會因為安慰經驗值剛好湊到升級門檻，反而用升級的全滿血蓋掉這次的敗北懲罰
          await prisma.user.update({
            where: { id: user.id },
            data: {
              xp: { increment: bonus.xpGained },
              gold: { increment: bonus.goldGained },
              health: bonus.finalHealth,
            },
          });
        } else {
          const { levelsGained, newMaxHealth, statIncrements } = computeLevelUp(
            updatedUser.level,
            updatedUser.xp + bonus.xpGained,
            postBattleStats.maxHealth
          );
          bonusLevelsGained = levelsGained;
          finalEffectiveMaxHealth = newMaxHealth;

          await prisma.user.update({
            where: { id: user.id },
            data: {
              xp: { increment: bonus.xpGained },
              gold: { increment: bonus.goldGained },
              ...statIncrements,
              health: levelsGained > 0 ? newMaxHealth : bonus.finalHealth,
            },
          });
        }

        finalUser = (await prisma.user.findUnique({ where: { userId } })) as User;
      }
    }

    // ── 連戰狀態 ──
    // 贏了就往下累積，連滿或落敗就歸零並讓冷卻從現在開始算。
    // lastBattle 在連戰期間不會被更新（第一場搶冷卻時寫過），所以冷卻是從整趟結束才起跳
    if (streakLimit > 1) {
      const nextStreak = result === "win" ? user.battleStreak + 1 : 0;
      const streakEnded = result !== "win" || nextStreak >= streakLimit;
      await prisma.user.update({
        where: { id: user.id },
        data: streakEnded
          ? { battleStreak: 0, streakEliteFired: false, lastBattle: new Date() }
          : {
              battleStreak: nextStreak,
              streakEliteFired: user.streakEliteFired || eliteAppearedThisFight,
            },
      });
      finalUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    }

    return {
      user: finalUser,
      enemyName,
      enemyLevel,
      enemyHealth,
      result,
      xpGained,
      goldGained,
      healthDelta: finalUser.health - user.health,
      rounds,
      effectiveMaxHealth: finalEffectiveMaxHealth,
      message,
      bonusEvents,
      bonusLevelsGained,
      battleStreak: finalUser.battleStreak,
      streakLimit,
    };
  }

  // ── 地下城：逐層下潛 ────────────────────────────────────────
  // 舊版是「一次指令連打 4 層」，實測難度是階梯函數而不是曲線（見 PRD 第 22 節）：
  // 鯨魚每 5 分鐘零風險全破、新手 0% 全破直接撞牆。改成玩家自己決定要往下走多深，
  // 存活率高於門檻時自動打（不打擾），跌破才停下來問——每一次問都是真實的取捨。
  //
  // 血量是沙盒的：進場滿血、離場回復成進場前的值。趟內不回血，血量就是下潛的燃料。

  /** 把一趟的現況整理成呼叫端要顯示的樣子，並即時算出「下一層」的存活率 */
  private static describeRun(
    run: DungeonRunRow,
    stats: EffectiveStats,
    autoCleared: DungeonClearedFloor[]
  ): Extract<DungeonEnterResult, { status: "at_decision" }> {
    const nextFloor = run.nextFloor as unknown as DungeonFloorPlan;
    return {
      status: "at_decision",
      clearedFloors: run.clearedFloors,
      health: run.health,
      maxHealth: run.maxHealth,
      goldPending: run.goldPending,
      xpPending: run.xpPending,
      lootPending: run.lootPending as unknown as PendingLoot[],
      nextFloor,
      survival: estimateSurvival(stats, nextFloor.enemy, run.health),
      autoCleared,
    };
  }

  /**
   * 打掉已經擲好的那一層，然後在安全的範圍內繼續自動下潛。
   * 回傳「停在決策點」或「死了」。dungeonEnter 跟 dungeonDescend 共用這一段。
   */
  private static async runFloors(
    user: User,
    stats: EffectiveStats,
    startRun: DungeonRunRow,
    fightFirst: boolean
  ): Promise<DungeonEnterResult> {
    let current = startRun;
    let shouldFight = fightFirst;
    const autoCleared: DungeonClearedFloor[] = [];

    for (;;) {
      const plan = current.nextFloor as unknown as DungeonFloorPlan;

      if (!shouldFight) {
        // 還沒打過這層：存活率夠高就自動打下去，否則停下來問玩家
        const survival = estimateSurvival(stats, plan.enemy, current.health);
        if (survival < AUTO_DESCEND_SURVIVAL_THRESHOLD || plan.floor > MAX_DUNGEON_FLOOR) {
          return this.describeRun(current, stats, autoCleared);
        }
      }
      shouldFight = false;

      const combat = simulateCombat(stats, plan.enemy, current.health);

      if (combat.result === "lose") {
        // 未入袋的金幣與材料全部沒收，經驗保留——經驗是「你花了這段時間」的證明，不是賭注
        const xpGained = current.xpPending;
        const goldForfeited = current.goldPending;
        const lootForfeited = current.lootPending as unknown as PendingLoot[];
        await this.settleRun(user, current, { gold: 0, xp: xpGained });
        return {
          status: "died",
          clearedFloors: current.clearedFloors,
          deathFloor: plan,
          xpGained,
          goldForfeited,
          lootForfeited,
          autoCleared,
        };
      }

      // 過關：獎勵先進「未入袋」的暫存，帶著離開才真的入袋
      const material = plan.givesMaterial ? await pickRareLootItem() : null;
      const lootPending = current.lootPending as unknown as PendingLoot[];
      const nextPlan = rollDungeonFloor(
        user.level,
        plan.floor + 1,
        isJobKey(user.job) ? user.job : null
      );
      const newLoot = material
        ? [...lootPending, { itemId: material.id, name: material.name, quantity: 1 }]
        : lootPending;

      // conditional update：層數必須還是我們讀到的那個值，兩邊同時按不會把同一層結算兩次
      const advanced = await prisma.dungeonRun.updateMany({
        where: { id: current.id, clearedFloors: current.clearedFloors },
        data: {
          clearedFloors: plan.floor,
          health: combat.finalHealth,
          goldPending: current.goldPending + plan.goldReward,
          xpPending: current.xpPending + plan.xpReward,
          lootPending: newLoot as unknown as Prisma.InputJsonValue,
          nextFloor: nextPlan as unknown as Prisma.InputJsonValue,
        },
      });
      if (advanced.count === 0) {
        throw new PlayerNotice("這一層剛剛已經被結算過了，請重新查看目前進度");
      }

      autoCleared.push({
        floor: plan.floor,
        enemyName: plan.enemy.name,
        enemyLevel: plan.enemy.level,
        affix: plan.affix,
        goldReward: plan.goldReward,
        xpReward: plan.xpReward,
        materialName: material?.name ?? null,
        healthAfter: combat.finalHealth,
        rounds: combat.rounds,
      });

      current = await prisma.dungeonRun.findUniqueOrThrow({ where: { id: current.id } });
    }
  }

  /** 結束一趟：把該給的獎勵入袋、血量回復進場前的值、刪掉這趟 */
  private static async settleRun(
    user: User,
    run: DungeonRunRow,
    payout: { gold: number; xp: number },
    loot: PendingLoot[] = []
  ): Promise<User> {
    return prisma.$transaction(async (tx) => {
      // 先用 conditional delete 搶下「結算這一趟」的權利，再發獎勵。
      // deleteMany 刪到 0 筆不會拋錯、交易照樣 commit，所以少了這道檢查就會變成複製戰利品的漏洞：
      // 「帶著離開」連點兩下時兩個請求都讀到同一趟、都發一次獎勵。
      // 帶上 clearedFloors 是為了另一個場景——連點兩下、一邊贏一邊輸時，
      // 輸的那邊會拿著過期的層數把贏的那邊剛推進的進度整個刪掉。
      const claimed = await tx.dungeonRun.deleteMany({
        where: { id: run.id, clearedFloors: run.clearedFloors },
      });
      if (claimed.count === 0) {
        throw new PlayerNotice("這一趟剛剛已經結算過了，請重新查看目前進度");
      }

      for (const entry of loot) {
        await tx.inventory.upsert({
          where: { userId_itemId: { userId: user.id, itemId: entry.itemId } },
          create: { userId: user.id, itemId: entry.itemId, quantity: entry.quantity },
          update: { quantity: { increment: entry.quantity } },
        });
      }

      const { statIncrements, newMaxHealth } = computeLevelUp(
        user.level,
        user.xp + payout.xp,
        run.maxHealth
      );

      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          gold: { increment: payout.gold },
          xp: { increment: payout.xp },
          ...statIncrements,
          // 沙盒：趟內的消耗不外洩，回到進場前的血量（升級的話不超過新上限）
          health: Math.min(run.healthBefore, newMaxHealth),
        },
      });

      return updated;
    });
  }

  /**
   * 進入地下城。有未完成的趟就回到那一趟（不重開、也不再扣一次冷卻），
   * 否則搶冷卻並開新的一趟，然後自動下潛到第一個真正的決策點。
   */
  static async dungeonEnter(discordUserId: string): Promise<DungeonEnterResult> {
    const user = await prisma.user.findUnique({ where: { userId: discordUserId } });
    if (!user) return { status: "not_started" };

    const stats = await ItemService.getEffectiveStats(user.id, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });

    // 地下城進場是滿血，但離場會回復成 healthBefore——那個值要是「已經算過離線回血」的，
    // 不然玩家等了一整晚的回血會在離開地下城時被抹掉
    const regen = await this.applyOfflineRegen(user.id);
    const userHealth = regen.health;

    const existing = await prisma.dungeonRun.findUnique({ where: { userId: user.id } });
    if (existing) {
      // 未完成的趟隨時可以回來繼續，不會過期、也不再扣一次冷卻
      return this.describeRun(existing, stats, []);
    }

    // 先搶冷卻再開趟，避免連點兩下開出兩趟
    const dungeonCutoff = new Date(Date.now() - DUNGEON_COOLDOWN_MS);
    const claimed = await prisma.user.updateMany({
      where: { id: user.id, OR: [{ lastDungeon: null }, { lastDungeon: { lt: dungeonCutoff } }] },
      data: { lastDungeon: new Date() },
    });
    if (claimed.count === 0) {
      const elapsed = Date.now() - new Date(user.lastDungeon!).getTime();
      return {
        status: "cooldown",
        remainingSeconds: Math.ceil((DUNGEON_COOLDOWN_MS - elapsed) / 1000),
      };
    }

    const run = await prisma.dungeonRun.create({
      data: {
        userId: user.id,
        clearedFloors: 0,
        health: stats.maxHealth, // 進場一律滿血
        maxHealth: stats.maxHealth,
        healthBefore: userHealth,
        lootPending: [] as unknown as Prisma.InputJsonValue,
        nextFloor: rollDungeonFloor(
          user.level,
          1,
          isJobKey(user.job) ? user.job : null
        ) as unknown as Prisma.InputJsonValue,
      },
    });

    return this.runFloors(user, stats, run, false);
  }

  /** 玩家按下「繼續下潛」：打掉眼前那一層，然後在安全範圍內繼續自動走 */
  static async dungeonDescend(discordUserId: string): Promise<DungeonDescendResult> {
    const user = await prisma.user.findUnique({ where: { userId: discordUserId } });
    if (!user) return { status: "not_started" };

    const run = await prisma.dungeonRun.findUnique({ where: { userId: user.id } });
    if (!run) return { status: "no_run" };

    const stats = await ItemService.getEffectiveStats(user.id, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });

    return this.runFloors(user, stats, run, true);
  }

  /** 玩家按下「帶著戰利品離開」：未入袋的東西全部入袋，這趟結束 */
  static async dungeonLeave(discordUserId: string): Promise<DungeonLeaveResult> {
    const user = await prisma.user.findUnique({ where: { userId: discordUserId } });
    if (!user) return { status: "not_started" };

    const run = await prisma.dungeonRun.findUnique({ where: { userId: user.id } });
    if (!run) return { status: "no_run" };

    const loot = run.lootPending as unknown as PendingLoot[];
    const updated = await this.settleRun(
      user,
      run,
      { gold: run.goldPending, xp: run.xpPending },
      loot
    );

    return {
      status: "left",
      clearedFloors: run.clearedFloors,
      goldGained: run.goldPending,
      xpGained: run.xpPending,
      loot,
      user: updated,
    };
  }

  static async fish(discordUserId: string): Promise<FishResult> {
    const user = await prisma.user.findUnique({ where: { userId: discordUserId } });
    if (!user) return { status: "not_started" };

    // 先搶冷卻再抽釣魚結果，避免「再釣一次」連點兩下繞過 60 秒冷卻
    const fishCutoff = new Date(Date.now() - FISH_COOLDOWN_MS);
    const claimedFish = await prisma.user.updateMany({
      where: { id: user.id, OR: [{ lastFish: null }, { lastFish: { lt: fishCutoff } }] },
      data: { lastFish: new Date() },
    });
    if (claimedFish.count === 0) {
      const elapsed = Date.now() - new Date(user.lastFish!).getTime();
      return {
        status: "cooldown",
        remainingSeconds: Math.ceil((FISH_COOLDOWN_MS - elapsed) / 1000),
      };
    }

    const job = isJobKey(user.job) ? user.job : null;
    if (randomChance(harvestEmptyChanceOverride(job) ?? EMPTY_CATCH_CHANCE)) {
      // lastFish 已經在上面搶冷卻時寫過了，不用再更新一次
      return { status: "empty", message: EMPTY_CATCH_MESSAGES[randomInt(0, EMPTY_CATCH_MESSAGES.length)] };
    }

    const effectiveStats = await ItemService.getEffectiveStats(user.id, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });
    const xpGained = Math.round(randomInt(2, 6) * (1 + effectiveStats.xpBonus / 100));

    const items = await harvest(user.id, FISH_TABLE, gatherRollCount(job), "seedFishItems");
    await prisma.user.update({ where: { id: user.id }, data: { xp: { increment: xpGained } } });

    return { status: "caught", items, xpGained };
  }

  static async gather(discordUserId: string): Promise<GatherResult> {
    const user = await prisma.user.findUnique({ where: { userId: discordUserId } });
    if (!user) return { status: "not_started" };

    // 先搶冷卻再抽採集結果，避免「再採一次」連點兩下繞過 60 秒冷卻
    const gatherCutoff = new Date(Date.now() - GATHER_COOLDOWN_MS);
    const claimedGather = await prisma.user.updateMany({
      where: { id: user.id, OR: [{ lastGather: null }, { lastGather: { lt: gatherCutoff } }] },
      data: { lastGather: new Date() },
    });
    if (claimedGather.count === 0) {
      const elapsed = Date.now() - new Date(user.lastGather!).getTime();
      return {
        status: "cooldown",
        remainingSeconds: Math.ceil((GATHER_COOLDOWN_MS - elapsed) / 1000),
      };
    }

    const job = isJobKey(user.job) ? user.job : null;
    if (randomChance(harvestEmptyChanceOverride(job) ?? GATHER_EMPTY_CHANCE)) {
      // lastGather 已經在上面搶冷卻時寫過了，不用再更新一次
      return {
        status: "empty",
        message: GATHER_EMPTY_MESSAGES[randomInt(0, GATHER_EMPTY_MESSAGES.length)],
      };
    }

    const effectiveStats = await ItemService.getEffectiveStats(user.id, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });
    const xpGained = Math.round(randomInt(2, 6) * (1 + effectiveStats.xpBonus / 100));

    const items = await harvest(user.id, GATHER_TABLE, gatherRollCount(job), "seedGatherItems");
    await prisma.user.update({ where: { id: user.id }, data: { xp: { increment: xpGained } } });

    return { status: "gathered", items, xpGained };
  }

  // 共用邏輯：/rpg daily 手動簽到、跳語音頻道自動簽到都呼叫這個，確保兩者行為完全一致
  static async claimDaily(discordUserId: string): Promise<DailyClaimResult> {
    const user = await prisma.user.findUnique({ where: { userId: discordUserId } });
    if (!user) {
      return { status: "not_started" };
    }

    const now = new Date();
    const lastDaily = user.lastDaily ? new Date(user.lastDaily) : null;
    const todayString = getLocalDateString(now);
    // 今天台北時間 00:00 的實際時間點，給下面的 conditional update 當「還沒領過今天」的判斷邊界用
    const todayStart = new Date(getNextResetTime(now).getTime() - 24 * 60 * 60 * 1000);

    const buildAlreadyClaimedResult = (): DailyClaimResult => {
      const tomorrow = getNextResetTime(now);
      const remainingTime = tomorrow.getTime() - now.getTime();
      const remainingHours = Math.floor(remainingTime / (60 * 60 * 1000));
      const remainingMinutes = Math.floor((remainingTime % (60 * 60 * 1000)) / (60 * 1000));
      return { status: "already_claimed", remainingHours, remainingMinutes };
    };

    if (lastDaily) {
      const lastDailyString = getLocalDateString(lastDaily);
      if (lastDailyString === todayString) {
        return buildAlreadyClaimedResult();
      }
    }

    // 生命上限跟金幣/經驗加成都要用「有效值」（含裝備加成），提前拿到才能一起套進獎勵計算
    const effectiveStats = await ItemService.getEffectiveStats(user.id, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });

    // 簽到的 +30% 要疊在離線回血之後的血量上，不然等了一整晚的回血會被這一行蓋掉
    const { health: healthAfterRegen } = await this.applyOfflineRegen(user.id);

    const baseGold = 50;
    const baseXP = 30;
    const goldMultiplier = 1 + user.level * 0.1;
    const xpMultiplier = 1 + user.level * 0.05;

    const dailyGoldRoll = randomInt(0, Math.floor(user.level * 5));
    const dailyXpRoll = randomInt(0, Math.floor(user.level * 3));

    const goldReward = Math.round(
      (baseGold + dailyGoldRoll) * goldMultiplier * (1 + effectiveStats.goldBonus / 100)
    );
    const xpReward = Math.round(
      (baseXP + dailyXpRoll) * xpMultiplier * (1 + effectiveStats.xpBonus / 100)
    );
    let streak = user.loginStreak || 0;
    const currentDate = todayString;
    const lastStreakDate = user.lastStreakDate;

    if (lastStreakDate) {
      const daysSinceLastStreak = daysBetweenDateStrings(lastStreakDate, currentDate);
      if (daysSinceLastStreak === 1) {
        streak += 1;
      } else if (daysSinceLastStreak === STREAK_GRACE_GAP_DAYS) {
        // 寬限期：漏簽一天不會歸零，但那天也不算數，所以連續天數保留、不增加
        //（不然「隔一天簽一次」也能無限累積，連續紀錄就沒有意義了）
        streak = Math.max(1, streak);
      } else {
        streak = 1;
      }
    } else {
      streak = 1;
    }

    // 連續獎勵改成「基礎金幣的百分比」：原本是每滿 5 天給固定 20 金幣，跟等級完全無關，
    // Lv20 時只佔基礎簽到金幣的 40%、Lv80 只剩 5%，等於越玩越無感；而且只有 5 的倍數那天
    // 才給，五天裡有四天完全看不到連續獎勵。改成百分比後會自動跟著等級成長，且每天都看得到。
    const streakBonusRatio = Math.min(streak, STREAK_BONUS_MAX_DAYS) * STREAK_BONUS_PER_DAY;
    const streakBonus = Math.round(goldReward * streakBonusRatio);
    const streakBonusPercent = Math.round(streakBonusRatio * 100);

    const finalGoldReward = goldReward + streakBonus;

    // 「還沒領過今天」的判斷跟寫入包在同一個 conditional update 裡：語音自動簽到跟手動 /rpg daily
    // 幾乎同時觸發時，只有一邊的 where 能命中（另一邊會因為 lastDaily 已經被搶先改成今天而落空），
    // 不會出現兩邊都通過前面的預先檢查、都各發一次獎勵的競態
    const claimedDaily = await prisma.user.updateMany({
      where: { id: user.id, OR: [{ lastDaily: null }, { lastDaily: { lt: todayStart } }] },
      data: {
        gold: { increment: finalGoldReward },
        xp: { increment: xpReward },
        lastDaily: now,
        health: Math.min(
          healthAfterRegen + Math.floor(effectiveStats.maxHealth * 0.3),
          effectiveStats.maxHealth
        ),
        loginStreak: streak,
        lastStreakDate: currentDate,
      },
    });

    if (claimedDaily.count === 0) {
      return buildAlreadyClaimedResult();
    }

    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    return {
      status: "claimed",
      goldReward,
      streakBonus,
      streakBonusPercent,
      finalGoldReward,
      xpReward,
      streak,
      updatedUser,
      effectiveMaxHealth: effectiveStats.maxHealth,
    };
  }
}
