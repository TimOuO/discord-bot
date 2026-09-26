import prisma from "./dbService";
import { PlayerNotice } from "../utils/errors";
import { isJobKey } from "./jobs";
import {
  ACHIEVEMENTS,
  TITLE_SHOP,
  achievedKeys,
  findAchievement,
  findTitle,
  type AchievementDefinition,
  type AchievementKey,
  type AchievementSnapshot,
  type TitleDefinition,
} from "./achievements";

/** 材料型道具的稀有度只在這兩種型別上算（跟強化材料的定義一致，藥水不算材料） */
const MATERIAL_TYPES = ["fish", "material"];

/** Prisma 的 unique 約束衝突 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002"
  );
}

export interface AchievementRow {
  definition: AchievementDefinition;
  unlocked: boolean;
  achievedAt: Date | null;
}

export interface TitleRow {
  definition: TitleDefinition;
  owned: boolean;
  equipped: boolean;
}

export class AchievementService {
  /** 把判斷成就要用的狀態一次查出來。全部都是當下的值，沒有任何累積計數 */
  static async snapshot(userInternalId: string): Promise<AchievementSnapshot> {
    const [user, enhance, mythicItemCount, materials] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userInternalId },
        select: { level: true, gold: true, loginStreak: true, job: true },
      }),
      prisma.itemInstance.aggregate({
        where: { userId: userInternalId },
        _max: { enhanceLevel: true },
      }),
      prisma.itemInstance.count({
        where: { userId: userInternalId, item: { rarity: "mythic" } },
      }),
      prisma.inventory.aggregate({
        where: {
          userId: userInternalId,
          item: { rarity: "legendary", type: { in: MATERIAL_TYPES } },
        },
        _sum: { quantity: true },
      }),
    ]);

    return {
      level: user.level,
      gold: user.gold,
      loginStreak: user.loginStreak,
      maxEnhanceLevel: enhance._max.enhanceLevel ?? 0,
      mythicItemCount,
      legendaryMaterialCount: materials._sum.quantity ?? 0,
      job: isJobKey(user.job) ? user.job : null,
    };
  }

  /**
   * 偵測並補記錄，回傳**這次新解鎖的** key（已經記過的不會再回報一次，
   * 否則玩家每打開一次資料卡就會被通知一輪）。
   *
   * 這是懶惰偵測的入口：由讀取端（資料卡、背包、成就列表、每日簽到）呼叫，
   * 不在戰鬥、強化那些動作點做。所以 achievedAt 記的是偵測到的時間，不是真正達成的時間。
   */
  static async sync(userInternalId: string): Promise<AchievementKey[]> {
    const snapshot = await this.snapshot(userInternalId);
    const qualified = achievedKeys(snapshot);
    if (qualified.length === 0) return [];

    const existing = await prisma.userAchievement.findMany({
      where: { userId: userInternalId, key: { in: qualified } },
      select: { key: true },
    });
    const already = new Set(existing.map((row) => row.key));

    // 一列一列寫，而不是 createMany：需要知道「哪幾個是這次真的寫進去的」才知道要通知哪幾個。
    // 兩個指令同時偵測到同一個成就時，晚的那個會撞 unique 約束——那代表別人已經通知過了，直接跳過
    const unlocked: AchievementKey[] = [];
    for (const key of qualified) {
      if (already.has(key)) continue;
      try {
        await prisma.userAchievement.create({ data: { userId: userInternalId, key } });
        unlocked.push(key);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    return unlocked;
  }

  /** 已解鎖的成就 key */
  static async unlockedKeys(userInternalId: string): Promise<AchievementKey[]> {
    const rows = await prisma.userAchievement.findMany({
      where: { userId: userInternalId },
      select: { key: true },
    });
    return rows.map((row) => row.key);
  }

  /** 成就列表畫面用：整份清單 + 各自解鎖了沒，順序跟 ACHIEVEMENTS 一致 */
  static async listAchievements(userInternalId: string): Promise<AchievementRow[]> {
    const rows = await prisma.userAchievement.findMany({ where: { userId: userInternalId } });
    const byKey = new Map(rows.map((row) => [row.key, row.achievedAt]));
    return ACHIEVEMENTS.map((definition) => ({
      definition,
      unlocked: byKey.has(definition.key),
      achievedAt: byKey.get(definition.key) ?? null,
    }));
  }

  /**
   * 玩家擁有哪些稱號。成就附贈的稱號不存第二份，直接從 UserAchievement 推出來，
   * 買來的才在 UserTitle 裡——兩邊都存的話遲早會有一邊落後
   */
  static async ownedTitleKeys(userInternalId: string): Promise<Set<string>> {
    const [achievements, purchased] = await Promise.all([
      prisma.userAchievement.findMany({
        where: { userId: userInternalId },
        select: { key: true },
      }),
      prisma.userTitle.findMany({ where: { userId: userInternalId }, select: { key: true } }),
    ]);
    return new Set([...achievements, ...purchased].map((row) => row.key));
  }

  /** 稱號店畫面用：成就附贈的 + 店裡賣的，各自擁有了沒、現在掛著的是哪一個 */
  static async listTitles(userInternalId: string): Promise<TitleRow[]> {
    const [owned, user] = await Promise.all([
      this.ownedTitleKeys(userInternalId),
      prisma.user.findUniqueOrThrow({
        where: { id: userInternalId },
        select: { title: true },
      }),
    ]);

    const achievementTitles: TitleDefinition[] = ACHIEVEMENTS.map((a) => ({
      key: a.key,
      text: a.title,
      source: "achievement",
    }));

    return [...achievementTitles, ...TITLE_SHOP].map((definition) => ({
      definition,
      owned: owned.has(definition.key),
      equipped: user.title === definition.key,
    }));
  }

  /**
   * 用金幣買稱號。扣款與「記下擁有」包在同一個 conditional update 裡（見 docs/adr/0003），
   * 不會有查完錢夠、扣款前錢被花掉的競態
   */
  static async buyTitle(userInternalId: string, titleKey: string): Promise<{ goldAfter: number }> {
    const title = TITLE_SHOP.find((t) => t.key === titleKey);
    if (!title || title.cost === undefined) {
      // 成就附贈的稱號走到這裡代表玩家想用錢跳過成就，不是程式錯誤
      const asAchievement = findAchievement(titleKey);
      throw new PlayerNotice(
        asAchievement
          ? `「${asAchievement.title}」是成就附贈的稱號，沒辦法用金幣買——條件是${asAchievement.requirement}。`
          : "稱號店沒有這個稱號，請重新執行 `/rpg title`。"
      );
    }

    // 先取出來，narrowing 才會穿過下面的 closure
    const cost = title.cost;

    return prisma.$transaction(async (tx) => {
      const existing = await tx.userTitle.findUnique({
        where: { userId_key: { userId: userInternalId, key: titleKey } },
      });
      if (existing) throw new PlayerNotice(`你已經擁有「${title.text}」了。`);

      const claimed = await tx.user.updateMany({
        where: { id: userInternalId, gold: { gte: cost } },
        data: { gold: { decrement: cost } },
      });
      if (claimed.count === 0) {
        const user = await tx.user.findUniqueOrThrow({ where: { id: userInternalId } });
        throw new PlayerNotice(
          `金幣不夠，「${title.text}」要 ${cost.toLocaleString("en-US")} 金幣，你只有 ${user.gold.toLocaleString("en-US")} 金幣。`
        );
      }

      // unique 約束是併發的最後一道防線：兩筆同時進來時，第二筆會在這裡失敗而整個交易回滾（錢也退回去）
      await tx.userTitle.create({ data: { userId: userInternalId, key: titleKey } });

      const user = await tx.user.findUniqueOrThrow({ where: { id: userInternalId } });
      return { goldAfter: user.gold };
    });
  }

  /** 掛上稱號，或傳 null 拿掉。只能掛已經擁有的 */
  static async equipTitle(userInternalId: string, titleKey: string | null): Promise<void> {
    if (titleKey !== null) {
      const title = findTitle(titleKey);
      if (!title) throw new PlayerNotice("沒有這個稱號，請重新執行 `/rpg title`。");

      const owned = await this.ownedTitleKeys(userInternalId);
      if (!owned.has(titleKey)) {
        throw new PlayerNotice(
          title.source === "achievement"
            ? `你還沒有「${title.text}」，要先達成對應的成就。`
            : `你還沒有「${title.text}」，要先在稱號店買下來。`
        );
      }
    }
    await prisma.user.update({ where: { id: userInternalId }, data: { title: titleKey } });
  }
}
