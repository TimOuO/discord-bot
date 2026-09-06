import { describe, it, expect } from "vitest";
import { RPGService } from "./rpgService";
import { createTestUser } from "../../test/helpers";
import prisma from "./dbService";

const HOUR = 60 * 60 * 1000;
const agoMs = (ms: number) => new Date(Date.now() - ms);

describe("RPGService.applyOfflineRegen", () => {
  it("離線 8 小時會把落敗保底的血量補回滿血，並寫進資料庫", async () => {
    const { user } = await createTestUser({ maxHealth: 1000, health: 300 });
    await prisma.user.update({
      where: { id: user.id },
      data: { lastHealthTick: agoMs(8 * HOUR) },
    });

    const result = await RPGService.applyOfflineRegen(user.id);

    expect(result.healed).toBe(700);
    expect(result.health).toBe(1000);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.health).toBe(1000);
  });

  it("回血量不足 1 點時「不推進時鐘」——否則頻繁下指令的新手永遠不會回血", async () => {
    // 上限 120 每小時只回 10 點，兩分鐘連 1 點都不到
    const { user } = await createTestUser({ maxHealth: 120, health: 60 });
    const tick = agoMs(2 * 60 * 1000);
    await prisma.user.update({ where: { id: user.id }, data: { lastHealthTick: tick } });

    const result = await RPGService.applyOfflineRegen(user.id);

    expect(result.healed).toBe(0);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.health).toBe(60);
    // 關鍵：時間戳沒有被推到現在，累積的時間才不會一直被歸零
    expect(after.lastHealthTick?.getTime()).toBe(tick.getTime());
  });

  it("連續呼叫多次，累積的時間仍然會兌現成回血", async () => {
    const { user } = await createTestUser({ maxHealth: 120, health: 60 });
    await prisma.user.update({
      where: { id: user.id },
      data: { lastHealthTick: agoMs(2 * 60 * 1000) },
    });

    // 前幾次都不足 1 點，但時鐘沒被歸零
    await RPGService.applyOfflineRegen(user.id);
    await RPGService.applyOfflineRegen(user.id);

    // 把時間戳往前推到一小時前，模擬時間真的過去了
    await prisma.user.update({
      where: { id: user.id },
      data: { lastHealthTick: agoMs(HOUR) },
    });
    const result = await RPGService.applyOfflineRegen(user.id);

    expect(result.healed).toBeGreaterThan(0);
  });

  it("既有玩家的 lastHealthTick 是 null 時，設成當下但不追溯發放", async () => {
    const { user } = await createTestUser({ maxHealth: 1000, health: 300 });
    expect(user.lastHealthTick).toBeNull();

    const result = await RPGService.applyOfflineRegen(user.id);

    expect(result.healed).toBe(0);
    expect(result.health).toBe(300);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.lastHealthTick).not.toBeNull();
  });

  it("已經滿血時不動任何東西", async () => {
    const { user } = await createTestUser({ maxHealth: 1000, health: 1000 });
    await prisma.user.update({
      where: { id: user.id },
      data: { lastHealthTick: agoMs(24 * HOUR) },
    });

    const result = await RPGService.applyOfflineRegen(user.id);

    expect(result.healed).toBe(0);
    expect(result.health).toBe(1000);
  });

  it("回血以「有效上限」為準，裝備加成也算進去", async () => {
    const { user } = await createTestUser({ maxHealth: 1000, health: 300, gold: 100_000 });
    const { ItemService } = await import("./itemService");
    const { createTestItem } = await import("../../test/helpers");
    const amulet = await createTestItem({
      type: "accessory",
      cost: 100,
      effectType: "maxHealth",
      effectValue: 1000,
    });
    await ItemService.buyItem(user.id, amulet.name); // 空欄位會自動裝備
    await prisma.user.update({
      where: { id: user.id },
      data: { lastHealthTick: agoMs(HOUR) },
    });

    const result = await RPGService.applyOfflineRegen(user.id);

    // 有效上限 2000，一小時回 8.75% = 175（而不是以基礎 1000 算的 87）
    expect(result.healed).toBe(175);
  });
});
