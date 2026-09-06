import { describe, it, expect } from "vitest";
import { RPGService } from "./rpgService";
import { createTestUser } from "../../test/helpers";
import prisma from "./dbService";

// 弱到第一層就是硬仗（存活率遠低於自動下潛門檻），所以 enter 會立刻停在第 1 層的決策點
async function weakPlayer() {
  return createTestUser({ level: 1, attack: 10, defense: 5, health: 100, maxHealth: 100 });
}

// 強到可以連續自動突破好幾層
async function strongPlayer() {
  return createTestUser({ level: 30, attack: 600, defense: 400, health: 8000, maxHealth: 8000 });
}

describe("RPGService.dungeonEnter", () => {
  it("開新趟會停在第一個「存活率跌破門檻」的決策點，並附上那一層的存活率", async () => {
    const { discordUserId } = await weakPlayer();

    const result = await RPGService.dungeonEnter(discordUserId);

    expect(result.status).toBe("at_decision");
    if (result.status !== "at_decision") return;
    expect(result.nextFloor.floor).toBe(result.clearedFloors + 1);
    expect(result.survival).toBeLessThan(0.9);
    expect(result.survival).toBeGreaterThanOrEqual(0);
  });

  it("強的玩家會自動突破好幾層才停下來問，不用一直按按鈕", async () => {
    const { discordUserId } = await strongPlayer();

    const result = await RPGService.dungeonEnter(discordUserId);

    expect(result.status).toBe("at_decision");
    if (result.status !== "at_decision") return;
    expect(result.clearedFloors).toBeGreaterThan(2);
    expect(result.goldPending).toBeGreaterThan(0);
  });

  it("進場一律滿血，不管進來之前剩多少", async () => {
    const { discordUserId, user } = await strongPlayer();
    await prisma.user.update({ where: { id: user.id }, data: { health: 1 } });

    await RPGService.dungeonEnter(discordUserId);

    const run = await prisma.dungeonRun.findUniqueOrThrow({ where: { userId: user.id } });
    expect(run.healthBefore).toBe(1);
    // 沙盒：趟內從滿血開始，所以打完幾層之後血量仍然遠高於進場前的 1
    expect(run.health).toBeGreaterThan(1);
  });

  it("有未完成的趟時，再次進入是回到原本那趟而不是重開", async () => {
    const { discordUserId, user } = await strongPlayer();
    const first = await RPGService.dungeonEnter(discordUserId);
    if (first.status !== "at_decision") throw new Error("預期停在決策點");

    const again = await RPGService.dungeonEnter(discordUserId);

    expect(again.status).toBe("at_decision");
    if (again.status !== "at_decision") return;
    expect(again.clearedFloors).toBe(first.clearedFloors);
    expect(again.goldPending).toBe(first.goldPending);
    expect(await prisma.dungeonRun.count({ where: { userId: user.id } })).toBe(1);
  });

  it("冷卻中而且沒有未完成的趟時，擋下來", async () => {
    const { discordUserId } = await strongPlayer();
    await RPGService.dungeonEnter(discordUserId);
    await RPGService.dungeonLeave(discordUserId); // 結束這趟，冷卻還在

    const result = await RPGService.dungeonEnter(discordUserId);

    expect(result.status).toBe("cooldown");
  });
});

describe("地下城的「還沒開始冒險」防線", () => {
  it("沒有角色資料時，進入/下潛/離開都回傳 not_started", async () => {
    const ghost = "user-does-not-exist";

    expect((await RPGService.dungeonEnter(ghost)).status).toBe("not_started");
    expect((await RPGService.dungeonDescend(ghost)).status).toBe("not_started");
    expect((await RPGService.dungeonLeave(ghost)).status).toBe("not_started");
  });
});

describe("RPGService.dungeonLeave", () => {
  it("帶著離開會把未入袋的金幣經驗入袋、刪掉這趟、血量回復進場前的值", async () => {
    const { discordUserId, user } = await strongPlayer();
    await prisma.user.update({ where: { id: user.id }, data: { health: 42, gold: 100 } });
    const entered = await RPGService.dungeonEnter(discordUserId);
    if (entered.status !== "at_decision") throw new Error("預期停在決策點");

    const result = await RPGService.dungeonLeave(discordUserId);

    expect(result.status).toBe("left");
    if (result.status !== "left") return;
    expect(result.goldGained).toBe(entered.goldPending);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.gold).toBe(100 + entered.goldPending);
    expect(after.health).toBe(42); // 沙盒：趟內的消耗不外洩
    expect(await prisma.dungeonRun.count({ where: { userId: user.id } })).toBe(0);
  });

  it("沒有進行中的趟時，離開會被擋下來", async () => {
    const { discordUserId } = await strongPlayer();

    const result = await RPGService.dungeonLeave(discordUserId);

    expect(result.status).toBe("no_run");
  });
});

describe("RPGService.dungeonDescend", () => {
  it("戰敗會沒收未入袋的金幣，但經驗保留", async () => {
    const { discordUserId, user } = await weakPlayer();
    await prisma.user.update({ where: { id: user.id }, data: { gold: 500 } });
    await RPGService.dungeonEnter(discordUserId);

    // 第一層對這個角色就是硬仗，多試幾次一定會遇到戰敗
    let died = false;
    for (let i = 0; i < 30 && !died; i++) {
      const result = await RPGService.dungeonDescend(discordUserId);
      if (result.status === "died") {
        died = true;
        expect(result.goldForfeited).toBeGreaterThanOrEqual(0);
        expect(result.xpGained).toBeGreaterThanOrEqual(0);

        const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
        expect(after.gold).toBe(500); // 一毛都沒進帳
        expect(await prisma.dungeonRun.count({ where: { userId: user.id } })).toBe(0);
      } else {
        await RPGService.dungeonLeave(discordUserId);
        await prisma.user.update({
          where: { id: user.id },
          data: { gold: 500, lastDungeon: null },
        });
        await RPGService.dungeonEnter(discordUserId);
      }
    }
    expect(died).toBe(true);
  });

  it("兩個併發下潛不會把同一層結算兩次（競態測試）", async () => {
    const { discordUserId, user } = await strongPlayer();
    const entered = await RPGService.dungeonEnter(discordUserId);
    if (entered.status !== "at_decision") throw new Error("預期停在決策點");

    const results = await Promise.allSettled([
      RPGService.dungeonDescend(discordUserId),
      RPGService.dungeonDescend(discordUserId),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const run = await prisma.dungeonRun.findUnique({ where: { userId: user.id } });
    // 這一層最多只被結算一次：不是還在同一層（兩邊都失敗），就是只前進了一層
    if (run) expect(run.clearedFloors).toBeLessThanOrEqual(entered.clearedFloors + 1);
  });

  it("沒有進行中的趟時，下潛會被擋下來", async () => {
    const { discordUserId } = await strongPlayer();

    const result = await RPGService.dungeonDescend(discordUserId);

    expect(result.status).toBe("no_run");
  });
});

describe("一趟只能結算一次（複製戰利品的防線）", () => {
  it("「帶著離開」連點兩下，獎勵只發一次", async () => {
    const { discordUserId, user } = await strongPlayer();
    await prisma.user.update({ where: { id: user.id }, data: { gold: 0, xp: 0 } });
    const entered = await RPGService.dungeonEnter(discordUserId);
    if (entered.status !== "at_decision") throw new Error("預期停在決策點");
    expect(entered.goldPending).toBeGreaterThan(0);

    const results = await Promise.allSettled([
      RPGService.dungeonLeave(discordUserId),
      RPGService.dungeonLeave(discordUserId),
    ]);

    const left = results.filter(
      (r) => r.status === "fulfilled" && r.value.status === "left"
    );
    expect(left).toHaveLength(1);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.gold).toBe(entered.goldPending); // 不是兩倍
    expect(await prisma.dungeonRun.count({ where: { userId: user.id } })).toBe(0);
  });

  it("「繼續下潛」連點兩下、兩邊都戰敗時，經驗只發一次", async () => {
    const { discordUserId, user } = await strongPlayer();
    await prisma.user.update({ where: { id: user.id }, data: { xp: 0 } });
    const entered = await RPGService.dungeonEnter(discordUserId);
    if (entered.status !== "at_decision") throw new Error("預期停在決策點");

    // 血量壓到 1，兩邊的模擬必然都是戰敗
    await prisma.dungeonRun.update({
      where: { userId: user.id },
      data: { health: 1 },
    });
    const pendingXp = entered.xpPending;
    expect(pendingXp).toBeGreaterThan(0);

    const results = await Promise.allSettled([
      RPGService.dungeonDescend(discordUserId),
      RPGService.dungeonDescend(discordUserId),
    ]);

    const died = results.filter(
      (r) => r.status === "fulfilled" && r.value.status === "died"
    );
    expect(died).toHaveLength(1);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.xp).toBe(pendingXp); // 不是兩倍
  });

  it("「離開」跟「下潛」同時進來時，只有一邊會生效", async () => {
    const { discordUserId, user } = await strongPlayer();
    await prisma.user.update({ where: { id: user.id }, data: { gold: 0 } });
    const entered = await RPGService.dungeonEnter(discordUserId);
    if (entered.status !== "at_decision") throw new Error("預期停在決策點");

    const results = await Promise.allSettled([
      RPGService.dungeonLeave(discordUserId),
      RPGService.dungeonDescend(discordUserId),
    ]);

    const settled = results.filter(
      (r) =>
        r.status === "fulfilled" &&
        (r.value.status === "left" || r.value.status === "died")
    );
    // 離開會結算並刪掉這趟；下潛若成功推進則這趟還在，但兩者不會同時結算
    expect(settled.length).toBeLessThanOrEqual(1);

    const run = await prisma.dungeonRun.findUnique({ where: { userId: user.id } });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (run) {
      // 下潛贏了、離開被擋下來：金幣還沒入袋
      expect(after.gold).toBe(0);
    } else {
      // 離開生效：入袋的金額就是離開當下的未入袋金額，不會被下潛的結果重複加
      expect(after.gold).toBe(entered.goldPending);
    }
  });
});
