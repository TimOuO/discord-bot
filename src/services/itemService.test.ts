import { describe, it, expect } from "vitest";
import { ItemService } from "./itemService";
import { createTestUser, createTestItem } from "../../test/helpers";
import prisma from "./dbService";

describe("ItemService.buyItem", () => {
  it("金幣足夠時，扣除金額並把道具加進背包", async () => {
    const { user } = await createTestUser({ gold: 100 });
    const item = await createTestItem({ cost: 60 });

    const result = await ItemService.buyItem(user.id, item.name);

    expect(result.quantity).toBe(1);

    const inventory = await ItemService.getInventory(user.id);
    expect(inventory.find((row) => row.itemId === item.id)?.quantity).toBe(1);
  });

  it("金幣不夠時拒絕購買", async () => {
    const { user } = await createTestUser({ gold: 10 });
    const item = await createTestItem({ cost: 60 });

    await expect(ItemService.buyItem(user.id, item.name)).rejects.toThrow("金幣不夠");
  });

  it("魚類道具不能用 buyItem 購買", async () => {
    const { user } = await createTestUser({ gold: 1000 });
    const fish = await createTestItem({ type: "fish", cost: 10, effectType: "none", effectValue: 0 });

    await expect(ItemService.buyItem(user.id, fish.name)).rejects.toThrow("不是商店販售的商品");
  });

  it("買武器時，空的武器欄會自動裝備", async () => {
    const { user } = await createTestUser({ gold: 1000 });
    const weapon = await createTestItem({ type: "weapon", cost: 50, effectType: "attack", effectValue: 20 });

    const result = await ItemService.buyItem(user.id, weapon.name);

    expect(result.autoEquippedSlot).toBe("weapon");
  });
});

describe("ItemService.sellItem", () => {
  it("賣掉道具會拿到原價一半的金幣，並減少背包數量", async () => {
    const { user } = await createTestUser({ gold: 100 });
    // 用不會被自動裝備的類型（potion），避免跟「裝備中不能賣」的規則互相干擾
    const item = await createTestItem({ type: "potion", cost: 100, effectType: "heal" });
    await ItemService.buyItem(user.id, item.name);

    const result = await ItemService.sellItem(user.id, item.name);

    expect(result.sellPrice).toBe(50);
    const inventory = await ItemService.getInventory(user.id);
    expect(inventory.find((row) => row.itemId === item.id)).toBeUndefined();
  });

  it("正在裝備中的最後一件不能賣掉", async () => {
    const { user } = await createTestUser({ gold: 1000 });
    const weapon = await createTestItem({ type: "weapon", cost: 50, effectType: "attack", effectValue: 20 });
    await ItemService.buyItem(user.id, weapon.name); // 會自動裝備（空欄位）

    await expect(ItemService.sellItem(user.id, weapon.name)).rejects.toThrow("目前正在裝備中");
  });

  it("可以一次指定數量賣出多個，金額跟庫存都照數量計算", async () => {
    const { user } = await createTestUser({ gold: 1000 });
    const item = await createTestItem({ type: "potion", cost: 100, effectType: "heal" });
    await ItemService.buyItem(user.id, item.name);
    await ItemService.buyItem(user.id, item.name);
    await ItemService.buyItem(user.id, item.name);

    const result = await ItemService.sellItem(user.id, item.name, 2);

    expect(result.sellPrice).toBe(100); // 50 * 2
    const inventory = await ItemService.getInventory(user.id);
    expect(inventory.find((row) => row.itemId === item.id)?.quantity).toBe(1);
  });

  it("指定數量超過可賣的上限時拒絕，並告知上限", async () => {
    const { user } = await createTestUser({ gold: 1000 });
    const item = await createTestItem({ type: "potion", cost: 100, effectType: "heal" });
    await ItemService.buyItem(user.id, item.name);
    await ItemService.buyItem(user.id, item.name);

    await expect(ItemService.sellItem(user.id, item.name, 5)).rejects.toThrow("最多只能賣 2 個");
  });

  it("魚類沒有商店售價，賣掉是全額而不是打五折", async () => {
    const { user } = await createTestUser({ gold: 0 });
    const fish = await createTestItem({
      type: "fish",
      cost: 10,
      effectType: "none",
      effectValue: 0,
    });
    // 魚不能用 buyItem 買，直接塞進背包模擬釣到的情境
    await prisma.inventory.create({ data: { userId: user.id, itemId: fish.id, quantity: 1 } });

    const result = await ItemService.sellItem(user.id, fish.name);

    expect(result.sellPrice).toBe(10); // 全額，不是 5
  });
});

describe("ItemService.sellAllOfItem", () => {
  it("把賣得動的數量全部賣掉", async () => {
    const { user } = await createTestUser({ gold: 1000 });
    const item = await createTestItem({ type: "potion", cost: 100, effectType: "heal" });
    await ItemService.buyItem(user.id, item.name);
    await ItemService.buyItem(user.id, item.name);
    await ItemService.buyItem(user.id, item.name);

    const result = await ItemService.sellAllOfItem(user.id, item.name);

    expect(result.amount).toBe(3);
    expect(result.sellPrice).toBe(150); // 50 * 3
    const inventory = await ItemService.getInventory(user.id);
    expect(inventory.find((row) => row.itemId === item.id)).toBeUndefined();
  });

  it("裝備中的那件不會被賣掉，只賣多出來的數量", async () => {
    const { user } = await createTestUser({ gold: 1000 });
    const weapon = await createTestItem({ type: "weapon", cost: 100, effectType: "attack", effectValue: 20 });
    await ItemService.buyItem(user.id, weapon.name); // 自動裝備這一件
    await ItemService.buyItem(user.id, weapon.name); // 這件留在背包沒裝備

    const result = await ItemService.sellAllOfItem(user.id, weapon.name);

    expect(result.amount).toBe(1);
    const inventory = await ItemService.getInventory(user.id);
    expect(inventory.find((row) => row.itemId === weapon.id)?.quantity).toBe(1);
  });

  it("全部都裝備中時拒絕", async () => {
    const { user } = await createTestUser({ gold: 1000 });
    const weapon = await createTestItem({ type: "weapon", cost: 100, effectType: "attack", effectValue: 20 });
    await ItemService.buyItem(user.id, weapon.name); // 自動裝備

    await expect(ItemService.sellAllOfItem(user.id, weapon.name)).rejects.toThrow("全部都在裝備中");
  });
});

describe("ItemService.useItem", () => {
  it("使用藥水會依 effectValue 回血，並封頂在有效生命上限", async () => {
    const { user } = await createTestUser({ gold: 1000, health: 50, maxHealth: 100 });
    const potion = await createTestItem({
      type: "potion",
      cost: 20,
      effectType: "heal",
      effectValue: 30,
    });
    await ItemService.buyItem(user.id, potion.name);

    const result = await ItemService.useItem(user.id, potion.name);

    expect(result.healedAmount).toBe(30);
    expect(result.newHealth).toBe(80);
  });

  it("生命值已滿時拒絕使用藥水", async () => {
    const { user } = await createTestUser({ gold: 1000, health: 100, maxHealth: 100 });
    const potion = await createTestItem({
      type: "potion",
      cost: 20,
      effectType: "heal",
      effectValue: 30,
    });
    await ItemService.buyItem(user.id, potion.name);

    await expect(ItemService.useItem(user.id, potion.name)).rejects.toThrow("已經是滿的");
  });
});

describe("ItemService.getEffectiveStats", () => {
  it("有效屬性 = 基礎屬性 + 已裝備道具的加成總和", async () => {
    const { user } = await createTestUser({ gold: 1000, attack: 10, defense: 5 });
    const weapon = await createTestItem({ type: "weapon", cost: 50, effectType: "attack", effectValue: 20 });
    const armor = await createTestItem({ type: "armor", cost: 50, effectType: "defense", effectValue: 8 });
    await ItemService.buyItem(user.id, weapon.name);
    await ItemService.buyItem(user.id, armor.name);

    const stats = await ItemService.getEffectiveStats(user.id, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });

    expect(stats.attack).toBe(30);
    expect(stats.defense).toBe(13);
  });
});
