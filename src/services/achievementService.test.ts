import { describe, it, expect, beforeAll } from "vitest";
import { AchievementService } from "./achievementService";
import { ItemService } from "./itemService";
import { achievementBonus } from "./achievements";
import { createTestUser, createTestItem, seedHarvestItems } from "../../test/helpers";
import prisma from "./dbService";

beforeAll(seedHarvestItems);

describe("AchievementService.sync", () => {
  it("剛開始玩的角色什麼都沒解鎖", async () => {
    const { user } = await createTestUser();
    expect(await AchievementService.sync(user.id)).toEqual([]);
  });

  it("等級到了就解鎖，而且記進資料庫", async () => {
    const { user } = await createTestUser({ level: 30 });

    expect(await AchievementService.sync(user.id)).toEqual(
      expect.arrayContaining(["level_10", "level_30"])
    );

    const rows = await prisma.userAchievement.findMany({ where: { userId: user.id } });
    expect(rows.map((r) => r.key).sort()).toEqual(["level_10", "level_30"]);
  });

  it("只回報「這次新解鎖的」，已經記過的不會再報一次——不然玩家每次開卡片都被通知一輪", async () => {
    const { user } = await createTestUser({ level: 10 });

    expect(await AchievementService.sync(user.id)).toEqual(["level_10"]);
    expect(await AchievementService.sync(user.id)).toEqual([]);
  });

  it("條件之後不符合了也不會被收回——成就是「曾經達成」", async () => {
    const { user } = await createTestUser({ gold: 10_000 });
    expect(await AchievementService.sync(user.id)).toEqual(["gold_10000"]);

    // 把錢花光
    await prisma.user.update({ where: { id: user.id }, data: { gold: 0 } });

    expect(await AchievementService.sync(user.id)).toEqual([]);
    const rows = await prisma.userAchievement.findMany({ where: { userId: user.id } });
    expect(rows.map((r) => r.key)).toEqual(["gold_10000"]);
  });

  it("同時跑兩次偵測不會寫出兩列，也不會兩次都回報解鎖（競態測試）", async () => {
    const { user } = await createTestUser({ level: 10 });

    const results = await Promise.all([
      AchievementService.sync(user.id),
      AchievementService.sync(user.id),
    ]);

    // 兩次加起來只有一次回報「新解鎖」，否則玩家會收到兩則通知
    expect(results.flat()).toEqual(["level_10"]);
    expect(
      await prisma.userAchievement.count({ where: { userId: user.id, key: "level_10" } })
    ).toBe(1);
  });

  it("強化成就看的是最高的那一件，不是某一件特定的裝備", async () => {
    const { user } = await createTestUser();
    const item = await createTestItem();
    await prisma.itemInstance.create({
      data: { userId: user.id, itemId: item.id, enhanceLevel: 3 },
    });
    await prisma.itemInstance.create({
      data: { userId: user.id, itemId: item.id, enhanceLevel: 8 },
    });

    expect(await AchievementService.sync(user.id)).toEqual(
      expect.arrayContaining(["enhance_5", "enhance_8"])
    );
  });

  it("神話裝備成就算的是持有的件數，沒穿在身上的也算", async () => {
    const { user } = await createTestUser();
    const mythic = await createTestItem({ rarity: "mythic" });
    await prisma.itemInstance.create({ data: { userId: user.id, itemId: mythic.id } });

    expect(await AchievementService.sync(user.id)).toContain("mythic_1");
  });

  it("傳說材料算的是庫存數量，史詩的不算", async () => {
    const { user } = await createTestUser();
    const legendary = await prisma.item.findFirstOrThrow({ where: { name: "星隕石" } });
    const epic = await prisma.item.findFirstOrThrow({ where: { name: "金礦" } });
    await prisma.inventory.create({ data: { userId: user.id, itemId: epic.id, quantity: 50 } });

    expect(await AchievementService.sync(user.id)).not.toContain("legendary_material_10");

    await prisma.inventory.create({
      data: { userId: user.id, itemId: legendary.id, quantity: 10 },
    });
    expect(await AchievementService.sync(user.id)).toContain("legendary_material_10");
  });

  it("職業成就換了職業也留著——「當過」是靠永久記錄累積出來的，資料庫沒有職業歷史", async () => {
    const { user } = await createTestUser({ level: 30, job: "smith" });
    expect(await AchievementService.sync(user.id)).toContain("job_smith");

    await prisma.user.update({ where: { id: user.id }, data: { job: "forager" } });
    expect(await AchievementService.sync(user.id)).toEqual(["job_forager"]);

    const rows = await prisma.userAchievement.findMany({ where: { userId: user.id } });
    expect(rows.map((r) => r.key)).toEqual(expect.arrayContaining(["job_smith", "job_forager"]));
  });
});

describe("成就加成真的進到有效屬性裡", () => {
  it("解鎖前後 getEffectiveStats 的攻擊力差額，剛好等於成就給的量", async () => {
    const { user } = await createTestUser({ level: 60, attack: 100, defense: 50, maxHealth: 500 });
    const base = { attack: user.attack, defense: user.defense, maxHealth: user.maxHealth };

    const before = await ItemService.getEffectiveStats(user.id, base);
    expect(before.attack).toBe(100);

    const unlocked = await AchievementService.sync(user.id);
    const after = await ItemService.getEffectiveStats(user.id, base);

    // 期望值從純規則獨立算出來，不是把實作再抄一遍
    expect(after.attack - before.attack).toBe(achievementBonus(unlocked).attack);
    expect(after.attack).toBe(100 + 2 + 5 + 10);
  });

  it("百分比類的加成也會加上去（爆擊率沒有基礎欄位，全部來自裝備跟成就）", async () => {
    const { user } = await createTestUser();
    const mythic = await createTestItem({ rarity: "mythic" });
    await prisma.itemInstance.create({ data: { userId: user.id, itemId: mythic.id } });
    await AchievementService.sync(user.id);

    const stats = await ItemService.getEffectiveStats(user.id, {
      attack: 10,
      defense: 5,
      maxHealth: 100,
    });
    expect(stats.critRate).toBe(2);
  });
});

describe("AchievementService 稱號", () => {
  it("買稱號會扣金幣，並記下擁有", async () => {
    const { user } = await createTestUser({ gold: 10_000 });

    await AchievementService.buyTitle(user.id, "shop_newcomer");

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.gold).toBe(5_000);
    expect(await prisma.userTitle.count({ where: { userId: user.id } })).toBe(1);
  });

  it("金幣不夠就買不到，也不會扣錢", async () => {
    const { user } = await createTestUser({ gold: 100 });

    await expect(AchievementService.buyTitle(user.id, "shop_newcomer")).rejects.toThrow("金幣不夠");

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.gold).toBe(100);
  });

  it("同一個稱號買第二次會被擋下來，不會白花錢", async () => {
    const { user } = await createTestUser({ gold: 20_000 });
    await AchievementService.buyTitle(user.id, "shop_newcomer");

    await expect(AchievementService.buyTitle(user.id, "shop_newcomer")).rejects.toThrow("已經擁有");

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.gold).toBe(15_000);
  });

  it("併發買同一個稱號只會成功一次，金幣只扣一次（競態測試）", async () => {
    const { user } = await createTestUser({ gold: 20_000 });

    const results = await Promise.allSettled([
      AchievementService.buyTitle(user.id, "shop_newcomer"),
      AchievementService.buyTitle(user.id, "shop_newcomer"),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.gold).toBe(15_000);
  });

  it("成就附贈的稱號不能用錢買", async () => {
    const { user } = await createTestUser({ gold: 1_000_000 });
    await expect(AchievementService.buyTitle(user.id, "level_10")).rejects.toThrow();
  });

  it("掛上買來的稱號", async () => {
    const { user } = await createTestUser({ gold: 10_000 });
    await AchievementService.buyTitle(user.id, "shop_newcomer");

    await AchievementService.equipTitle(user.id, "shop_newcomer");

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.title).toBe("shop_newcomer");
  });

  it("沒擁有的稱號掛不上去", async () => {
    const { user } = await createTestUser();
    await expect(AchievementService.equipTitle(user.id, "shop_richest")).rejects.toThrow("還沒有");
  });

  it("解鎖成就就等於擁有它附贈的稱號，不用另外買", async () => {
    const { user } = await createTestUser({ level: 10 });
    await AchievementService.sync(user.id);

    await AchievementService.equipTitle(user.id, "level_10");

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.title).toBe("level_10");
  });

  it("可以拿掉稱號", async () => {
    const { user } = await createTestUser({ level: 10, title: "level_10" });
    await AchievementService.sync(user.id);

    await AchievementService.equipTitle(user.id, null);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.title).toBeNull();
  });
});
