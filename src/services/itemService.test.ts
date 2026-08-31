import { describe, it, expect } from "vitest";
import { ItemService } from "./itemService";
import { createTestUser, createTestItem } from "../../test/helpers";

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
