import { describe, it, expect, beforeAll } from "vitest";
import { RPGService } from "./rpgService";
import { ItemService } from "./itemService";
import { createTestUser, createTestItem, seedHarvestItems } from "../../test/helpers";
import prisma from "./dbService";

beforeAll(seedHarvestItems);

// 這一批測試存在的理由：jobPassives.test.ts 只測了純函式，例如 enhanceFailureDropsLevel(6, "smith")，
// 那些全部通過——但正式環境裡星火匠神跟深淵掠者的被動完全沒有生效，因為呼叫端從來沒把 job 傳進去。
// 所以這裡每個測試都一律走「玩家實際會按的那個入口」，驗的是接線而不是函式本身。

describe("星火匠神：透過 enhanceInstance 實際強化", () => {
  async function smithWithWeaponAt(level: number) {
    const { user } = await createTestUser({ level: 40, gold: 1_000_000 });
    const weapon = await createTestItem({
      type: "weapon",
      rarity: "common",
      cost: 100,
      effectType: "attack",
      effectValue: 20,
    });
    await ItemService.buyItem(user.id, weapon.name);
    const instance = await prisma.itemInstance.findFirstOrThrow({
      where: { userId: user.id, itemId: weapon.id },
    });
    await prisma.itemInstance.update({ where: { id: instance.id }, data: { enhanceLevel: level } });
    // +6 以上要付材料：普通裝備吃普通材料，備足
    const material = await createTestItem({
      type: "material",
      rarity: "common",
      cost: 10,
      effectType: "none",
    });
    await prisma.inventory.create({
      data: { userId: user.id, itemId: material.id, quantity: 500 },
    });
    const uncommon = await createTestItem({
      type: "material",
      rarity: "uncommon",
      cost: 30,
      effectType: "none",
    });
    await prisma.inventory.create({
      data: { userId: user.id, itemId: uncommon.id, quantity: 500 },
    });
    return { user, instanceId: instance.id };
  }

  // 反覆強化直到遇到一次失敗，回傳那次失敗的結果
  async function enhanceUntilFailure(userId: string, instanceId: string, level: number) {
    for (let i = 0; i < 60; i++) {
      const result = await ItemService.enhanceInstance(userId, instanceId);
      if (!result.success) return result;
      await prisma.itemInstance.update({
        where: { id: instanceId },
        data: { enhanceLevel: level },
      });
    }
    throw new Error("60 次都成功，機率上不可能");
  }

  it("沒有職業時，+6 衝 +7 失敗會退回 +5", async () => {
    const { user, instanceId } = await smithWithWeaponAt(6);

    const failure = await enhanceUntilFailure(user.id, instanceId, 6);

    expect(failure.droppedLevel).toBe(true);
    expect(failure.newLevel).toBe(5);
  });

  it("星火匠神 +6 衝 +7 失敗不退級", async () => {
    const { user, instanceId } = await smithWithWeaponAt(6);
    await prisma.user.update({ where: { id: user.id }, data: { job: "smith" } });

    const failure = await enhanceUntilFailure(user.id, instanceId, 6);

    expect(failure.droppedLevel).toBe(false);
    expect(failure.newLevel).toBe(6);
  });

  // 玩家實際回報的就是這個情境：在 +7 衝 +8 失敗被退回 +6。
  // 規則改成保護到衝 +8 為止之後，這裡要維持在 +7
  it("星火匠神 +7 衝 +8 失敗不退級", async () => {
    const { user, instanceId } = await smithWithWeaponAt(7);
    await prisma.user.update({ where: { id: user.id }, data: { job: "smith" } });

    const failure = await enhanceUntilFailure(user.id, instanceId, 7);

    expect(failure.droppedLevel).toBe(false);
    expect(failure.newLevel).toBe(7);
  });

  it("星火匠神 +8 衝 +9 失敗照樣退級（保護到衝 +8 為止）", async () => {
    const { user, instanceId } = await smithWithWeaponAt(8);
    await prisma.user.update({ where: { id: user.id }, data: { job: "smith" } });

    const failure = await enhanceUntilFailure(user.id, instanceId, 8);

    expect(failure.droppedLevel).toBe(true);
    expect(failure.newLevel).toBe(7);
  });
});

describe("深淵掠者：透過 dungeonEnter 實際下潛", () => {
  // 強到每一層存活率都是 100%，自動下潛會一路打到硬上限，拿得到很多層的材料紀錄
  async function unstoppable(job: "delver" | null) {
    const { discordUserId, user } = await createTestUser({
      level: 30,
      attack: 99_999,
      defense: 99_999,
      health: 999_999,
      maxHealth: 999_999,
    });
    if (job) await prisma.user.update({ where: { id: user.id }, data: { job } });
    return discordUserId;
  }

  async function materialFloors(discordUserId: string): Promise<number[]> {
    const result = await RPGService.dungeonEnter(discordUserId);
    if (result.status !== "at_decision" && result.status !== "died") {
      throw new Error(`預期進得了地下城，實際是 ${result.status}`);
    }
    return result.autoCleared.filter((f) => f.materialName !== null).map((f) => f.floor);
  }

  it("沒有職業時材料落在第 2、6、10 層（每 4 層）", async () => {
    const floors = await materialFloors(await unstoppable(null));

    expect(floors).toContain(2);
    expect(floors).toContain(6);
    expect(floors).not.toContain(5);
  });

  it("深淵掠者的材料落在第 2、5、8 層（每 3 層）", async () => {
    const floors = await materialFloors(await unstoppable("delver"));

    expect(floors).toContain(2);
    expect(floors).toContain(5);
    expect(floors).toContain(8);
    expect(floors).not.toContain(6);
  });
});

describe("血戰鬥神：連戰的併發", () => {
  it("連戰中連點兩下「繼續連戰」，只會打一場（不會複製獎勵）", async () => {
    const { discordUserId, user } = await createTestUser({
      level: 30,
      attack: 900,
      defense: 700,
      health: 20000,
      maxHealth: 20000,
    });
    await prisma.user.update({ where: { id: user.id }, data: { job: "berserker" } });
    await RPGService.battle(discordUserId); // 第 1 場，進入連戰
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(before.battleStreak).toBe(1);

    const results = await Promise.allSettled([
      RPGService.battle(discordUserId),
      RPGService.battle(discordUserId),
    ]);

    const fought = results.filter((r) => r.status === "fulfilled");
    expect(fought).toHaveLength(1);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.battleStreak).toBe(2); // 只前進一場，不是兩場
  });
});
