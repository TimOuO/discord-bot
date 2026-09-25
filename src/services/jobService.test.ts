import { describe, it, expect } from "vitest";
import { RPGService } from "./rpgService";
import { JOB_UNLOCK_LEVEL, JOB_CHANGE_COST } from "./jobs";
import { createTestUser } from "../../test/helpers";
import prisma from "./dbService";

describe("RPGService.chooseJob", () => {
  it("Lv30 以下不能轉職", async () => {
    const { discordUserId } = await createTestUser({ level: JOB_UNLOCK_LEVEL - 1 });

    const result = await RPGService.chooseJob(discordUserId, "smith");

    expect(result.status).toBe("level_too_low");
    if (result.status !== "level_too_low") return;
    expect(result.requiredLevel).toBe(JOB_UNLOCK_LEVEL);
  });

  it("第一次轉職免費", async () => {
    const { discordUserId, user } = await createTestUser({ level: JOB_UNLOCK_LEVEL, gold: 0 });

    const result = await RPGService.chooseJob(discordUserId, "smith");

    expect(result.status).toBe("changed");
    if (result.status !== "changed") return;
    expect(result.cost).toBe(0);
    expect(result.job).toBe("smith");

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.job).toBe("smith");
    expect(after.jobChangedOnce).toBe(true);
    expect(after.gold).toBe(0); // 沒扣錢
  });

  it("第二次轉職要付金幣", async () => {
    const { discordUserId, user } = await createTestUser({
      level: JOB_UNLOCK_LEVEL,
      gold: JOB_CHANGE_COST + 500,
    });
    await RPGService.chooseJob(discordUserId, "smith");

    const result = await RPGService.chooseJob(discordUserId, "delver");

    expect(result.status).toBe("changed");
    if (result.status !== "changed") return;
    expect(result.cost).toBe(JOB_CHANGE_COST);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.job).toBe("delver");
    expect(after.gold).toBe(500);
  });

  it("第二次轉職金幣不夠時擋下來，職業不會被改掉", async () => {
    const { discordUserId, user } = await createTestUser({ level: JOB_UNLOCK_LEVEL, gold: 100 });
    await RPGService.chooseJob(discordUserId, "smith");

    const result = await RPGService.chooseJob(discordUserId, "forager");

    expect(result.status).toBe("not_enough_gold");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.job).toBe("smith");
    expect(after.gold).toBe(100);
  });

  it("選跟現在一樣的職業會被擋下來，不會白花 2 萬金幣", async () => {
    const { discordUserId, user } = await createTestUser({
      level: JOB_UNLOCK_LEVEL,
      gold: JOB_CHANGE_COST * 2,
    });
    await RPGService.chooseJob(discordUserId, "smith");
    const goldAfterFirst = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).gold;

    const result = await RPGService.chooseJob(discordUserId, "smith");

    expect(result.status).toBe("already_that_job");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.gold).toBe(goldAfterFirst);
  });

  it("兩個併發轉職不會扣兩次錢（競態測試）", async () => {
    const { discordUserId, user } = await createTestUser({
      level: JOB_UNLOCK_LEVEL,
      gold: JOB_CHANGE_COST + 100,
    });
    await RPGService.chooseJob(discordUserId, "smith"); // 用掉免費那次

    const results = await Promise.allSettled([
      RPGService.chooseJob(discordUserId, "delver"),
      RPGService.chooseJob(discordUserId, "forager"),
    ]);

    const changed = results.filter((r) => r.status === "fulfilled" && r.value.status === "changed");
    expect(changed).toHaveLength(1);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.gold).toBe(100); // 只被扣一次
  });

  it("沒有角色資料時回傳 not_started", async () => {
    const result = await RPGService.chooseJob("ghost-user", "smith");

    expect(result.status).toBe("not_started");
  });
});
