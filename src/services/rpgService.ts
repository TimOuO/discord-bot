import { Item, User } from "../generated/prisma";
import { randomInt } from "crypto";
import prisma from "./dbService";
import { ItemService } from "./itemService";

const FISH_COOLDOWN_MS = 60 * 1000;
const EMPTY_CATCH_CHANCE = 0.05;
const EMPTY_CATCH_MESSAGES = [
  "魚餌被偷吃了，什麼都沒釣到...",
  "等了老半天，連個影子都沒有。",
  "魚線斷了！這次白忙一場。",
  "只釣到一隻舊靴子。",
];

// 稀有度權重：數字越大越常見，總和不用是 100，pickWeightedFish 會自己按比例抽
const FISH_TABLE: { name: string; weight: number }[] = [
  { name: "小魚乾", weight: 50 },
  { name: "虹鱒", weight: 30 },
  { name: "銀鱗鮭", weight: 15 },
  { name: "深海鮟鱇魚", weight: 4 },
  { name: "黃金鯉魚", weight: 1 },
];

// 升到某等級需要的「累計」總經驗值，平方成長：等級越高，落差越大
// 舊公式是純線性（level*100），導致等級越高完全沒有變難，18 級只要 1800 經驗
export function xpThresholdForLevel(level: number): number {
  return 50 * level * level;
}

function pickWeightedFish(): string {
  const totalWeight = FISH_TABLE.reduce((sum, fish) => sum + fish.weight, 0);
  let roll = randomInt(0, totalWeight);
  for (const fish of FISH_TABLE) {
    if (roll < fish.weight) return fish.name;
    roll -= fish.weight;
  }
  return FISH_TABLE[0].name;
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

export type FishResult =
  | { status: "not_started" }
  | { status: "cooldown"; remainingSeconds: number }
  | { status: "empty"; message: string }
  | { status: "caught"; item: Item; quantity: number; xpGained: number };

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
    message: string;
  }> {
    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      throw new Error("使用者不存在，請先使用 /rpg start 指令開始遊戲");
    }

    if (
      user.lastBattle &&
      new Date().getTime() - new Date(user.lastBattle).getTime() < 30 * 1000
    ) {
      const remainingTime = Math.ceil(
        (30 * 1000 -
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

    const enemyLevel = Math.max(1, user.level - 1 + randomInt(-1, 3));
    const enemyTypes = [
      "哥布林",
      "史萊姆",
      "骷髏戰士",
      "狼人",
      "山賊",
      "食人魔",
      "惡靈",
      "巨蜥",
    ];
    const enemyName = enemyTypes[randomInt(0, enemyTypes.length)];

    const enemyHealth = 80 + enemyLevel * 10;
    const enemyAttack = 8 + enemyLevel * 2;
    const enemyDefense = 4 + enemyLevel;

    let userHealth = user.health;
    let currentEnemyHealth = enemyHealth;
    let rounds = 0;

    while (userHealth > 0 && currentEnemyHealth > 0) {
      rounds++;
      const userDamage = Math.max(
        1,
        effectiveStats.attack - enemyDefense + randomInt(-2, 3)
      );
      currentEnemyHealth -= userDamage;

      if (currentEnemyHealth > 0) {
        const enemyDamage = Math.max(
          1,
          enemyAttack - effectiveStats.defense + randomInt(-2, 3)
        );
        userHealth -= enemyDamage;
      }
    }

    const result = userHealth > 0 ? "win" : "lose";
    let xpGained = 0;
    let goldGained = 0;
    let message = "";

    if (result === "win") {
      xpGained = 10 + enemyLevel * 5 + randomInt(1, 6);
      goldGained = 5 + enemyLevel * 2 + randomInt(0, 5);

      const currentLevel = user.level;
      const newXP = user.xp + xpGained;

      // 用迴圈處理單場戰鬥獲得的經驗值一次跨過多個等級門檻的情況
      let newLevel = currentLevel;
      while (newXP >= xpThresholdForLevel(newLevel)) {
        newLevel++;
      }
      const levelsGained = newLevel - currentLevel;
      const newMaxHealth = effectiveStats.maxHealth + levelsGained * 10;

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
          health: levelsGained > 0 ? newMaxHealth : Math.min(userHealth + 10, newMaxHealth),
        },
      });
    } else {
      xpGained = Math.max(1, Math.floor(enemyLevel * 2));
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

    return {
      user: updatedUser,
      enemyName,
      enemyLevel,
      enemyHealth,
      result,
      xpGained,
      goldGained,
      healthDelta: updatedUser.health - user.health,
      rounds,
      message,
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

    const fishName = pickWeightedFish();
    const item = await ItemService.findItemByName(fishName);
    if (!item) {
      throw new Error(`魚類資料「${fishName}」尚未建立，請先執行種子腳本 seedFishItems`);
    }

    const xpGained = randomInt(2, 6);

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

    const baseGold = 50;
    const baseXP = 30;
    const goldMultiplier = 1 + user.level * 0.1;
    const xpMultiplier = 1 + user.level * 0.05;

    const goldBonus = randomInt(0, Math.floor(user.level * 5));
    const xpBonus = randomInt(0, Math.floor(user.level * 3));

    const goldReward = Math.floor((baseGold + goldBonus) * goldMultiplier);
    const xpReward = Math.floor((baseXP + xpBonus) * xpMultiplier);
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
          user.health + Math.floor(user.maxHealth * 0.3),
          user.maxHealth
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
    };
  }
}
