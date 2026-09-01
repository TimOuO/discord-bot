import { Item, User } from "../generated/prisma";
import { randomInt } from "crypto";
import prisma from "./dbService";
import { ItemService } from "./itemService";
import type { EffectiveStats } from "./itemService";

const BATTLE_COOLDOWN_MS = 30 * 1000;
const DUNGEON_COOLDOWN_MS = 5 * 60 * 1000;
const DUNGEON_FLOOR_COUNT = 4;

const ENEMY_TYPES = ["哥布林", "史萊姆", "骷髏戰士", "狼人", "山賊", "食人魔", "惡靈", "巨蜥"];
const DUNGEON_BOSS_TYPES = ["地城領主", "遠古巨龍", "深淵魔王", "屍骨君王", "熔岩巨人", "暗影統領"];
const ELITE_ENEMY_TYPES = ["菁英哥布林王", "血眼狼王", "暗影刺客", "巨人守衛", "毒沼巫妖", "鋼鐵傀儡"];

// 打贏主戰鬥後，這兩個是各自獨立的骰子，都判斷過（可能同一場戰鬥兩個都中，也可能都沒中）
const BATTLE_LOOT_EVENT_CHANCE = 0.35;
const BATTLE_ELITE_EVENT_CHANCE = 0.2;

// 打贏一場戰鬥回血的比例：改成百分比而不是固定 +10，
// 換成百分比減傷公式後每場戰鬥動輒損血幾十到上百點，固定 +10 早就變得聊勝於無
const WIN_HEAL_RATIO = 0.15;

function healOnWin(currentHealth: number, maxHealth: number): number {
  return Math.min(currentHealth + Math.round(maxHealth * WIN_HEAL_RATIO), maxHealth);
}

interface EnemyEncounter {
  name: string;
  level: number;
  health: number;
  attack: number;
  defense: number;
}

function rollEnemy(level: number, namePool: string[]): EnemyEncounter {
  return {
    name: namePool[randomInt(0, namePool.length)],
    level,
    health: 80 + level * 10,
    attack: 8 + level * 2,
    defense: 4 + level,
  };
}

// 單場戰鬥的回合模擬，/rpg battle 跟 /rpg dungeon 的每一層都共用同一套規則
// 防禦 100 減傷 50%（200 減傷 66%，以此類推），只會「減傷」不會「完全免疫」；
// 舊公式是直接相減（傷害=攻擊-防禦），防禦一旦超過攻擊就會被保底傷害卡死在 1，
// 裝備越堆越強反而讓戰鬥完全沒難度，改百分比減傷後不管數值再怎麼成長都不會出現這個問題
const DEFENSE_MITIGATION_CONSTANT = 100;

function calculateDamage(attack: number, defense: number): number {
  const mitigated = (attack * DEFENSE_MITIGATION_CONSTANT) / (DEFENSE_MITIGATION_CONSTANT + defense);
  return Math.max(1, Math.round(mitigated) + randomInt(-2, 3));
}

function simulateCombat(
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
    if (randomInt(0, 100) < effectiveStats.critRate) {
      userDamage *= 2;
    }
    currentEnemyHealth -= userDamage;

    if (currentEnemyHealth > 0) {
      // 閃避：裝備 dodgeRate 加成的機率讓這回合完全不受傷
      const dodged = randomInt(0, 100) < effectiveStats.dodgeRate;
      if (!dodged) {
        const enemyDamage = calculateDamage(enemy.attack, effectiveStats.defense);
        userHealth -= enemyDamage;
      }
    }
  }

  return { result: userHealth > 0 ? "win" : "lose", finalHealth: userHealth, rounds };
}

const FISH_COOLDOWN_MS = 60 * 1000;
const EMPTY_CATCH_CHANCE = 0.05;
const EMPTY_CATCH_MESSAGES = [
  "魚餌被偷吃了，什麼都沒釣到...",
  "等了老半天，連個影子都沒有。",
  "魚線斷了！這次白忙一場。",
  "只釣到一隻舊靴子。",
];

const GATHER_COOLDOWN_MS = 60 * 1000;
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
const FISH_TABLE: WeightedTier[] = [
  { weight: 50, names: ["小魚乾", "泥鰍", "吳郭魚"] },
  { weight: 30, names: ["虹鱒", "鯖魚", "花枝"] },
  { weight: 15, names: ["銀鱗鮭", "龍虎斑", "紅魽"] },
  { weight: 4, names: ["深海鮟鱇魚", "電鰻", "小鯊魚"] },
  { weight: 1, names: ["黃金鯉魚", "傳說錦鯉", "神秘魚王"] },
];

const GATHER_TABLE: WeightedTier[] = [
  { weight: 50, names: ["樹枝", "石頭", "麻繩"] },
  { weight: 30, names: ["鐵礦", "煤炭", "硬木"] },
  { weight: 15, names: ["銀礦", "玉石", "陳年木材"] },
  { weight: 4, names: ["金礦", "藍水晶", "魔力碎片"] },
  { weight: 1, names: ["紫水晶", "星隕石", "遠古符文石"] },
];

// 升到某等級需要的「累計」總經驗值，平方成長：等級越高，落差越大
// 舊公式是純線性（level*100），導致等級越高完全沒有變難，18 級只要 1800 經驗
export function xpThresholdForLevel(level: number): number {
  return 50 * level * level;
}

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
async function grantRareLoot(userId: string): Promise<RareLoot | null> {
  const table = Math.random() < 0.5 ? FISH_TABLE : GATHER_TABLE;
  const lootName = pickFromWeightedTiers(table.slice(2));
  const item = await ItemService.findItemByName(lootName);
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
  currentHealth: number
): Promise<{ events: BattleBonusEvent[]; xpGained: number; goldGained: number; finalHealth: number }> {
  const events: BattleBonusEvent[] = [];
  let xpGained = 0;
  let goldGained = 0;
  let finalHealth = currentHealth;

  if (Math.random() < BATTLE_LOOT_EVENT_CHANCE) {
    if (Math.random() < 0.5) {
      const amount = Math.round((20 + user.level * 5 + randomInt(0, 10)) * (1 + effectiveStats.goldBonus / 100));
      goldGained += amount;
      events.push({ type: "gold", amount });
    } else {
      const lootName =
        Math.random() < 0.5 ? pickFromWeightedTiers(FISH_TABLE) : pickFromWeightedTiers(GATHER_TABLE);
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

  if (Math.random() < BATTLE_ELITE_EVENT_CHANCE) {
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

  return { events, xpGained, goldGained, finalHealth };
}

const DAILY_RESET_TIMEZONE = "Asia/Taipei";

function getLocalDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DAILY_RESET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// 每日重置的邊界是台北時間 00:00，固定用 +08:00 換算，跟主機所在時區無關
function getNextResetTime(date: Date): Date {
  const todayStr = getLocalDateString(date);
  const next = new Date(`${todayStr}T00:00:00+08:00`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

// 用純字串運算算「隔天」，避免用 Date 物件的 local getDate/setDate 造成時區偏移
function addDaysToDateString(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

export interface DungeonFloorResult {
  floor: number;
  enemyName: string;
  enemyLevel: number;
  result: "win" | "lose";
  rounds: number;
  xpGained: number;
  goldGained: number;
  rareLoot: RareLoot | null;
}

export type DungeonResult =
  | { status: "not_started" }
  | { status: "cooldown"; remainingSeconds: number }
  | {
      status: "completed";
      floors: DungeonFloorResult[];
      clearedAllFloors: boolean;
      totalXpGained: number;
      totalGoldGained: number;
      completionBonusGold: number;
      completionBonusXp: number;
      user: User;
      effectiveMaxHealth: number;
      healthDelta: number;
    };

export type FishResult =
  | { status: "not_started" }
  | { status: "cooldown"; remainingSeconds: number }
  | { status: "empty"; message: string }
  | { status: "caught"; item: Item; quantity: number; xpGained: number };

export type GatherResult =
  | { status: "not_started" }
  | { status: "cooldown"; remainingSeconds: number }
  | { status: "empty"; message: string }
  | { status: "gathered"; item: Item; quantity: number; xpGained: number };

export type DailyClaimResult =
  | { status: "not_started" }
  | { status: "already_claimed"; remainingHours: number; remainingMinutes: number }
  | {
      status: "claimed";
      goldReward: number;
      streakBonus: number;
      finalGoldReward: number;
      xpReward: number;
      streak: number;
      updatedUser: User;
      effectiveMaxHealth: number;
    };

export class RPGService {
  static async findUserByDiscordId(userId: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { userId } });
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

  static async startRPG(userId: string, username: string): Promise<User> {
    return this.getOrCreateUser(userId, username);
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
  }> {
    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      throw new Error("使用者不存在，請先使用 /rpg start 指令開始遊戲");
    }

    if (
      user.lastBattle &&
      new Date().getTime() - new Date(user.lastBattle).getTime() < BATTLE_COOLDOWN_MS
    ) {
      const remainingTime = Math.ceil(
        (BATTLE_COOLDOWN_MS -
          (new Date().getTime() - new Date(user.lastBattle).getTime())) /
          1000
      );
      throw new Error(`戰鬥冷卻中，請等待 ${remainingTime} 秒後再試`);
    }

    // 有效屬性 = 基礎屬性 + 目前裝備加成，戰鬥傷害要用有效屬性計算，裝備才會真正影響戰鬥
    const effectiveStats = await ItemService.getEffectiveStats(user.id, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });

    const enemy = rollEnemy(Math.max(1, user.level - 1 + randomInt(-1, 3)), ENEMY_TYPES);
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

      const currentLevel = user.level;
      const newXP = user.xp + xpGained;

      // 用迴圈處理單場戰鬥獲得的經驗值一次跨過多個等級門檻的情況
      let newLevel = currentLevel;
      while (newXP >= xpThresholdForLevel(newLevel)) {
        newLevel++;
      }
      const levelsGained = newLevel - currentLevel;
      const newMaxHealth = effectiveStats.maxHealth + levelsGained * 10;
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
          lastBattle: new Date(),
          ...(levelsGained > 0
            ? {
                level: { increment: levelsGained },
                attack: { increment: levelsGained * 2 },
                defense: { increment: levelsGained },
                maxHealth: { increment: levelsGained * 10 },
              }
            : {}),
          // health 取決於這場戰鬥模擬出的結果，不是相對資料庫舊值的增減，所以維持絕對值寫入
          // 升級的話直接補滿；沒升級才維持原本「贏了回一點血」的規則
          health: levelsGained > 0 ? newMaxHealth : healOnWin(userHealth, newMaxHealth),
        },
      });
    } else {
      xpGained = Math.max(1, Math.round(enemyLevel * 2 * (1 + effectiveStats.xpBonus / 100)));
      message = `你被 ${enemyName} 擊敗了，獲得了 ${xpGained} 點經驗值作為安慰。休息一下再來挑戰吧！`;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          xp: { increment: xpGained },
          health: Math.max(10, Math.floor(effectiveStats.maxHealth * 0.3)),
          lastBattle: new Date(),
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

    if (result === "win") {
      const postBattleStats = await ItemService.getEffectiveStats(updatedUser.id, {
        attack: updatedUser.attack,
        defense: updatedUser.defense,
        maxHealth: updatedUser.maxHealth,
      });
      const bonus = await rollBattleBonusEvent(updatedUser, postBattleStats, updatedUser.health);

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
          const currentLevel = updatedUser.level;
          const newXP = updatedUser.xp + bonus.xpGained;
          let newLevel = currentLevel;
          while (newXP >= xpThresholdForLevel(newLevel)) {
            newLevel++;
          }
          const levelsGained = newLevel - currentLevel;
          bonusLevelsGained = levelsGained;
          const newMaxHealth = postBattleStats.maxHealth + levelsGained * 10;
          finalEffectiveMaxHealth = levelsGained > 0 ? newMaxHealth : postBattleStats.maxHealth;

          await prisma.user.update({
            where: { id: user.id },
            data: {
              xp: { increment: bonus.xpGained },
              gold: { increment: bonus.goldGained },
              ...(levelsGained > 0
                ? {
                    level: { increment: levelsGained },
                    attack: { increment: levelsGained * 2 },
                    defense: { increment: levelsGained },
                    maxHealth: { increment: levelsGained * 10 },
                  }
                : {}),
              health: levelsGained > 0 ? newMaxHealth : bonus.finalHealth,
            },
          });
        }

        finalUser = (await prisma.user.findUnique({ where: { userId } })) as User;
      }
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
    };
  }

  // 一次指令連打 DUNGEON_FLOOR_COUNT 層，血量在層與層之間延續、不會回滿；
  // 中途輸了就整趟結束，但已經過關那幾層的獎勵會保留（不會歸零重來），全部過關再加一筆完成獎勵
  static async dungeon(discordUserId: string): Promise<DungeonResult> {
    const user = await prisma.user.findUnique({ where: { userId: discordUserId } });
    if (!user) return { status: "not_started" };

    if (user.lastDungeon) {
      const elapsed = Date.now() - new Date(user.lastDungeon).getTime();
      if (elapsed < DUNGEON_COOLDOWN_MS) {
        return {
          status: "cooldown",
          remainingSeconds: Math.ceil((DUNGEON_COOLDOWN_MS - elapsed) / 1000),
        };
      }
    }

    const effectiveStats = await ItemService.getEffectiveStats(user.id, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });

    const floors: DungeonFloorResult[] = [];
    let currentHealth = user.health;
    let totalXpGained = 0;
    let totalGoldGained = 0;
    let clearedAllFloors = true;

    for (let floor = 1; floor <= DUNGEON_FLOOR_COUNT; floor++) {
      const isBoss = floor === DUNGEON_FLOOR_COUNT;
      // 每層比上一層高兩級左右，最後一層是額外加成的 boss
      const baseLevel = Math.max(1, user.level - 2 + (floor - 1) * 2 + randomInt(0, 3));
      const enemy = rollEnemy(baseLevel, isBoss ? DUNGEON_BOSS_TYPES : ENEMY_TYPES);
      if (isBoss) {
        enemy.health = Math.round(enemy.health * 1.55);
        enemy.attack = Math.round(enemy.attack * 1.33);
      }

      const { result, finalHealth, rounds } = simulateCombat(effectiveStats, enemy, currentHealth);

      let xpGained: number;
      let goldGained = 0;
      let rareLoot: RareLoot | null = null;
      if (result === "win") {
        xpGained = Math.round((10 + enemy.level * 5 + randomInt(1, 6)) * (1 + effectiveStats.xpBonus / 100));
        goldGained = Math.round((5 + enemy.level * 2 + randomInt(0, 5)) * (1 + effectiveStats.goldBonus / 100));
        // 過關跟 battle() 贏了一樣小回血，但封頂在裝備加成後的上限（等級提升要等整趟結束才結算）
        currentHealth = healOnWin(finalHealth, effectiveStats.maxHealth);
        // 只有 boss 層（第 4 層）打贏才保證額外掉一件稀有材料，前面幾層的普通敵人沒有
        if (isBoss) {
          rareLoot = await grantRareLoot(user.id);
        }
      } else {
        xpGained = Math.max(1, Math.round(enemy.level * 2 * (1 + effectiveStats.xpBonus / 100)));
        // 輸的話跟 battle() 一樣血量掉到有效上限的 30%，整趟到此結束
        currentHealth = Math.max(10, Math.floor(effectiveStats.maxHealth * 0.3));
      }

      totalXpGained += xpGained;
      totalGoldGained += goldGained;
      floors.push({ floor, enemyName: enemy.name, enemyLevel: enemy.level, result, rounds, xpGained, goldGained, rareLoot });

      if (result === "lose") {
        clearedAllFloors = false;
        break;
      }
    }

    let completionBonusGold = 0;
    let completionBonusXp = 0;
    if (clearedAllFloors) {
      completionBonusGold = 100 + user.level * 10;
      completionBonusXp = 50 + user.level * 5;
      totalGoldGained += completionBonusGold;
      totalXpGained += completionBonusXp;
    }

    const currentLevel = user.level;
    const newXP = user.xp + totalXpGained;
    let newLevel = currentLevel;
    while (newXP >= xpThresholdForLevel(newLevel)) {
      newLevel++;
    }
    const levelsGained = newLevel - currentLevel;
    const newMaxHealth = effectiveStats.maxHealth + levelsGained * 10;
    const effectiveMaxHealth = levelsGained > 0 ? newMaxHealth : effectiveStats.maxHealth;
    const finalHealthValue = levelsGained > 0 ? newMaxHealth : Math.min(currentHealth, effectiveMaxHealth);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        xp: { increment: totalXpGained },
        gold: { increment: totalGoldGained },
        lastDungeon: new Date(),
        ...(levelsGained > 0
          ? {
              level: { increment: levelsGained },
              attack: { increment: levelsGained * 2 },
              defense: { increment: levelsGained },
              maxHealth: { increment: levelsGained * 10 },
            }
          : {}),
        health: finalHealthValue,
      },
    });

    const updatedUser = (await prisma.user.findUnique({ where: { userId: discordUserId } })) as User;

    return {
      status: "completed",
      floors,
      clearedAllFloors,
      totalXpGained,
      totalGoldGained,
      completionBonusGold,
      completionBonusXp,
      user: updatedUser,
      effectiveMaxHealth,
      healthDelta: updatedUser.health - user.health,
    };
  }

  static async fish(discordUserId: string): Promise<FishResult> {
    const user = await prisma.user.findUnique({ where: { userId: discordUserId } });
    if (!user) return { status: "not_started" };

    if (user.lastFish) {
      const elapsed = Date.now() - new Date(user.lastFish).getTime();
      if (elapsed < FISH_COOLDOWN_MS) {
        return {
          status: "cooldown",
          remainingSeconds: Math.ceil((FISH_COOLDOWN_MS - elapsed) / 1000),
        };
      }
    }

    if (Math.random() < EMPTY_CATCH_CHANCE) {
      await prisma.user.update({ where: { id: user.id }, data: { lastFish: new Date() } });
      return { status: "empty", message: EMPTY_CATCH_MESSAGES[randomInt(0, EMPTY_CATCH_MESSAGES.length)] };
    }

    const fishName = pickFromWeightedTiers(FISH_TABLE);
    const item = await ItemService.findItemByName(fishName);
    if (!item) {
      throw new Error(`魚類資料「${fishName}」尚未建立，請先執行種子腳本 seedFishItems`);
    }

    const effectiveStats = await ItemService.getEffectiveStats(user.id, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });
    const xpGained = Math.round(randomInt(2, 6) * (1 + effectiveStats.xpBonus / 100));

    const [, inventory] = await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { lastFish: new Date(), xp: { increment: xpGained } },
      }),
      prisma.inventory.upsert({
        where: { userId_itemId: { userId: user.id, itemId: item.id } },
        create: { userId: user.id, itemId: item.id, quantity: 1 },
        update: { quantity: { increment: 1 } },
      }),
    ]);

    return { status: "caught", item, quantity: inventory.quantity, xpGained };
  }

  static async gather(discordUserId: string): Promise<GatherResult> {
    const user = await prisma.user.findUnique({ where: { userId: discordUserId } });
    if (!user) return { status: "not_started" };

    if (user.lastGather) {
      const elapsed = Date.now() - new Date(user.lastGather).getTime();
      if (elapsed < GATHER_COOLDOWN_MS) {
        return {
          status: "cooldown",
          remainingSeconds: Math.ceil((GATHER_COOLDOWN_MS - elapsed) / 1000),
        };
      }
    }

    if (Math.random() < GATHER_EMPTY_CHANCE) {
      await prisma.user.update({ where: { id: user.id }, data: { lastGather: new Date() } });
      return {
        status: "empty",
        message: GATHER_EMPTY_MESSAGES[randomInt(0, GATHER_EMPTY_MESSAGES.length)],
      };
    }

    const materialName = pickFromWeightedTiers(GATHER_TABLE);
    const item = await ItemService.findItemByName(materialName);
    if (!item) {
      throw new Error(`材料資料「${materialName}」尚未建立，請先執行種子腳本 seedGatherItems`);
    }

    const effectiveStats = await ItemService.getEffectiveStats(user.id, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });
    const xpGained = Math.round(randomInt(2, 6) * (1 + effectiveStats.xpBonus / 100));

    const [, inventory] = await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { lastGather: new Date(), xp: { increment: xpGained } },
      }),
      prisma.inventory.upsert({
        where: { userId_itemId: { userId: user.id, itemId: item.id } },
        create: { userId: user.id, itemId: item.id, quantity: 1 },
        update: { quantity: { increment: 1 } },
      }),
    ]);

    return { status: "gathered", item, quantity: inventory.quantity, xpGained };
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

    if (lastDaily) {
      const lastDailyString = getLocalDateString(lastDaily);
      if (lastDailyString === todayString) {
        const tomorrow = getNextResetTime(now);
        const remainingTime = tomorrow.getTime() - now.getTime();
        const remainingHours = Math.floor(remainingTime / (60 * 60 * 1000));
        const remainingMinutes = Math.floor(
          (remainingTime % (60 * 60 * 1000)) / (60 * 1000)
        );
        return { status: "already_claimed", remainingHours, remainingMinutes };
      }
    }

    // 生命上限跟金幣/經驗加成都要用「有效值」（含裝備加成），提前拿到才能一起套進獎勵計算
    const effectiveStats = await ItemService.getEffectiveStats(user.id, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });

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
    let streakBonus = 0;
    const currentDate = todayString;
    const lastStreakDate = user.lastStreakDate;

    if (lastStreakDate) {
      const expectedNextDate = addDaysToDateString(lastStreakDate, 1);

      if (expectedNextDate === currentDate) {
        streak += 1;
        if (streak % 5 === 0) {
          streakBonus = Math.floor(streak / 5) * 20;
        }
      } else {
        streak = 1;
      }
    } else {
      streak = 1;
    }

    const finalGoldReward = goldReward + streakBonus;

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        gold: { increment: finalGoldReward },
        xp: { increment: xpReward },
        lastDaily: now,
        health: Math.min(
          user.health + Math.floor(effectiveStats.maxHealth * 0.3),
          effectiveStats.maxHealth
        ),
        loginStreak: streak,
        lastStreakDate: currentDate,
      },
    });

    return {
      status: "claimed",
      goldReward,
      streakBonus,
      finalGoldReward,
      xpReward,
      streak,
      updatedUser,
      effectiveMaxHealth: effectiveStats.maxHealth,
    };
  }
}
