import { describe, it, expect, beforeAll } from "vitest";
import { RPGService, BATTLE_COOLDOWN_MS, BERSERKER_COOLDOWN_MS } from "./rpgService";
import { maxBattleStreak } from "./jobs";
import { createTestUser, seedHarvestItems } from "../../test/helpers";
import prisma from "./dbService";

beforeAll(seedHarvestItems);

// 強到穩贏，才測得到「連戰能連下去」而不是被隨機的落敗打斷
async function berserker() {
  const created = await createTestUser({
    level: 30,
    attack: 900,
    defense: 700,
    health: 20000,
    maxHealth: 20000,
  });
  await prisma.user.update({ where: { id: created.user.id }, data: { job: "berserker" } });
  return created;
}

async function plainFighter() {
  return createTestUser({
    level: 30,
    attack: 900,
    defense: 700,
    health: 20000,
    maxHealth: 20000,
  });
}

describe("血戰鬥神的連戰", () => {
  it("沒有職業的人打完一場就進冷卻", async () => {
    const { discordUserId } = await plainFighter();

    await RPGService.battle(discordUserId);

    await expect(RPGService.battle(discordUserId)).rejects.toThrow("冷卻");
  });

  it("血戰鬥神打贏之後可以立刻再打，不用等冷卻", async () => {
    const { discordUserId, user } = await berserker();

    await RPGService.battle(discordUserId);
    await RPGService.battle(discordUserId); // 沒有等待

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.battleStreak).toBe(2);
  });

  it("連滿 5 場之後進入冷卻，而且是比較長的那個", async () => {
    const { discordUserId, user } = await berserker();

    for (let i = 0; i < maxBattleStreak("berserker"); i++) {
      await RPGService.battle(discordUserId);
    }

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.battleStreak).toBe(0); // 連戰結束

    await expect(RPGService.battle(discordUserId)).rejects.toThrow("冷卻");
    expect(BERSERKER_COOLDOWN_MS).toBeGreaterThan(BATTLE_COOLDOWN_MS);
  });

  it("敵人等級會隨著連戰場次往上加", async () => {
    const { discordUserId } = await berserker();

    const first = await RPGService.battle(discordUserId);
    const second = await RPGService.battle(discordUserId);
    const third = await RPGService.battle(discordUserId);

    // 敵人等級本身有隨機偏移，但三場的趨勢一定是往上（每場 +3 遠大於偏移範圍）
    expect(third.enemyLevel).toBeGreaterThan(first.enemyLevel);
    expect(second.enemyLevel).toBeGreaterThan(first.enemyLevel - 3);
  });

  it("整趟連戰保證至少遭遇一次菁英怪", async () => {
    const { discordUserId } = await berserker();

    let eliteCount = 0;
    for (let i = 0; i < maxBattleStreak("berserker"); i++) {
      const result = await RPGService.battle(discordUserId);
      eliteCount += result.bonusEvents.filter((e) => e.type === "elite").length;
    }

    expect(eliteCount).toBeGreaterThanOrEqual(1);
  });

  it("落敗會結束連戰並進入冷卻", async () => {
    const { discordUserId, user } = await berserker();
    await RPGService.battle(discordUserId);

    // 血量壓到 1 還不夠——攻擊力 900 會在第一回合就把敵人秒掉、完全沒被打到，
    // 攻擊力也要一起砍掉，戰鬥才會拖到玩家先倒下
    await prisma.user.update({
      where: { id: user.id },
      data: { health: 1, attack: 1, defense: 1 },
    });
    const result = await RPGService.battle(discordUserId);

    expect(result.result).toBe("lose");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.battleStreak).toBe(0);
    await expect(RPGService.battle(discordUserId)).rejects.toThrow("冷卻");
  });

  it("換掉職業之後連戰狀態會歸零，不會帶著舊的連戰跑", async () => {
    const { discordUserId, user } = await berserker();
    await prisma.user.update({ where: { id: user.id }, data: { gold: 100_000 } });
    await RPGService.battle(discordUserId);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).battleStreak).toBe(1);

    await RPGService.chooseJob(discordUserId, "smith");

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.battleStreak).toBe(0);
    expect(after.streakEliteFired).toBe(false);
  });
});
