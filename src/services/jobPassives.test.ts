import { describe, it, expect, beforeAll } from "vitest";
import { materialFloor } from "./dungeonRun";
import { enhanceFailureDropsLevel } from "./itemService";
import { RPGService } from "./rpgService";
import { createTestUser, seedHarvestItems } from "../../test/helpers";

beforeAll(seedHarvestItems);
import prisma from "./dbService";

// 這一批測的是「被動真的改到規則」，不是「常數變了」——
// 常數本身由 jobs.test.ts 顧，這裡驗的是各系統有沒有真的去問職業
describe("深淵掠者：地下城材料里程碑", () => {
  it("沒有職業時每 4 層一件（第 2、6、10）", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((f) => materialFloor(f, null))).toEqual([
      false, true, false, false, false, true, false,
    ]);
  });

  it("深淵掠者改成每 3 層一件（第 2、5、8）", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((f) => materialFloor(f, "delver"))).toEqual([
      false, true, false, false, true, false, false, true,
    ]);
  });

  it("其他職業不會影響地下城", () => {
    expect(materialFloor(5, "smith")).toBe(false);
    expect(materialFloor(6, "smith")).toBe(true);
  });
});

describe("星火匠神：強化失敗退級門檻", () => {
  it("沒有職業時 +6 以上失敗就退級", () => {
    expect(enhanceFailureDropsLevel(5, null)).toBe(false);
    expect(enhanceFailureDropsLevel(6, null)).toBe(true);
    expect(enhanceFailureDropsLevel(8, null)).toBe(true);
  });

  it("星火匠神的 +6、+7 失敗不退級，+8 以上照樣退", () => {
    expect(enhanceFailureDropsLevel(6, "smith")).toBe(false);
    expect(enhanceFailureDropsLevel(7, "smith")).toBe(false);
    expect(enhanceFailureDropsLevel(8, "smith")).toBe(true);
    expect(enhanceFailureDropsLevel(10, "smith")).toBe(true);
  });

  it("其他職業不會影響強化", () => {
    expect(enhanceFailureDropsLevel(6, "delver")).toBe(true);
  });
});

describe("荒野獵者：釣魚採集擲兩次骰子", () => {
  // 釣魚/採集有 5% 空手率，不重試的話這幾個測試會有 5% 機率無故失敗
  async function harvestUntilSuccess(
    discordUserId: string,
    userInternalId: string,
    action: "fish" | "gather"
  ) {
    const cooldownField = action === "fish" ? "lastFish" : "lastGather";
    for (let i = 0; i < 30; i++) {
      const result = await RPGService[action](discordUserId);
      if (result.status === "caught" || result.status === "gathered") return result;
      await prisma.user.update({
        where: { id: userInternalId },
        data: { [cooldownField]: null },
      });
    }
    throw new Error(`重試 30 次都空手，機率上不可能（空手率只有 5%）`);
  }

  it("沒有職業時一次採集只拿一份", async () => {
    const { discordUserId, user } = await createTestUser({ level: 40 });

    const result = await harvestUntilSuccess(discordUserId, user.id, "gather");

    expect(result.items).toHaveLength(1);
  });

  it("荒野獵者一次採集拿兩份（可能是不同材料）", async () => {
    const { discordUserId, user } = await createTestUser({ level: 40 });
    await prisma.user.update({ where: { id: user.id }, data: { job: "forager" } });

    const result = await harvestUntilSuccess(discordUserId, user.id, "gather");

    expect(result.items).toHaveLength(2);
  });

  it("荒野獵者連採 40 次都不會空手（一般玩家 5% 會空手）", async () => {
    const { discordUserId, user } = await createTestUser({ level: 40 });
    await prisma.user.update({ where: { id: user.id }, data: { job: "forager" } });

    for (let i = 0; i < 40; i++) {
      const result = await RPGService.gather(discordUserId);
      expect(result.status).toBe("gathered");
      await prisma.user.update({ where: { id: user.id }, data: { lastGather: null } });
    }
  });

  it("釣魚也一樣是兩份", async () => {
    const { discordUserId, user } = await createTestUser({ level: 40 });
    await prisma.user.update({ where: { id: user.id }, data: { job: "forager" } });

    const result = await harvestUntilSuccess(discordUserId, user.id, "fish");

    expect(result.items).toHaveLength(2);
  });
});
