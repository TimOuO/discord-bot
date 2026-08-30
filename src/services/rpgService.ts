import { User } from "../generated/prisma";
import { randomInt } from "crypto";
import prisma from "./dbService";
import { ItemService } from "./itemService";

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

    while (userHealth > 0 && currentEnemyHealth > 0) {
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
      while (newXP >= newLevel * 100) {
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
          health: Math.min(userHealth + 10, newMaxHealth),
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
      message,
    };
  }
}
