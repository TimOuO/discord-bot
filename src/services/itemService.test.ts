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

  it("金幣只夠買一次時，兩個併發購買只有一個會成功（競態測試）", async () => {
    const { user } = await createTestUser({ gold: 100 });
    const item = await createTestItem({ type: "potion", cost: 60, effectType: "heal" });

    const results = await Promise.allSettled([
      ItemService.buyItem(user.id, item.name),
      ItemService.buyItem(user.id, item.name),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // 金幣只會被扣一次，不會被扣成負數
    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updatedUser.gold).toBe(40);
    const inventory = await ItemService.getInventory(user.id);
    expect(inventory.find((row) => row.itemId === item.id)?.quantity).toBe(1);
  });

  it("魚類道具不能用 buyItem 購買", async () => {
    const { user } = await createTestUser({ gold: 1000 });
    const fish = await createTestItem({
      type: "fish",
      cost: 10,
      effectType: "none",
      effectValue: 0,
      purchasable: false,
    });

    await expect(ItemService.buyItem(user.id, fish.name)).rejects.toThrow("不是商店販售的商品");
  });

  it("飾品欄有三格，買第三件飾品時會自動裝進飾品欄 3", async () => {
    const { user } = await createTestUser({ gold: 1000 });
    const accA = await createTestItem({ type: "accessory", cost: 50, effectType: "attack", effectValue: 5 });
    const accB = await createTestItem({ type: "accessory", cost: 50, effectType: "defense", effectValue: 5 });
    const accC = await createTestItem({ type: "accessory", cost: 50, effectType: "maxHealth", effectValue: 10 });
    await ItemService.buyItem(user.id, accA.name); // accessory1
    await ItemService.buyItem(user.id, accB.name); // accessory2

    const result = await ItemService.buyItem(user.id, accC.name);

    expect(result.autoEquippedSlot).toBe("accessory3");
  });

  it("買武器時，空的武器欄會自動裝備", async () => {
    const { user } = await createTestUser({ gold: 1000 });
    const weapon = await createTestItem({ type: "weapon", cost: 50, effectType: "attack", effectValue: 20 });

    const result = await ItemService.buyItem(user.id, weapon.name);

    expect(result.autoEquippedSlot).toBe("weapon");
  });

  it("可以一次指定數量購買多個，金額跟庫存都照數量計算", async () => {
    const { user } = await createTestUser({ gold: 1000 });
    const item = await createTestItem({ type: "potion", cost: 60, effectType: "heal", effectValue: 30 });

    const result = await ItemService.buyItem(user.id, item.name, 3);

    expect(result.boughtAmount).toBe(3);
    expect(result.totalCost).toBe(180);
    expect(result.quantity).toBe(3);
    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updatedUser.gold).toBe(820);
  });

  it("金幣不夠買指定數量時拒絕", async () => {
    const { user } = await createTestUser({ gold: 100 });
    const item = await createTestItem({ cost: 60 });

    await expect(ItemService.buyItem(user.id, item.name, 2)).rejects.toThrow("金幣不夠");
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
    expect(result.goldAfter).toBe(50); // 買之前 100 金幣，花 100 買、賣回 50，剩 50
    const inventory = await ItemService.getInventory(user.id);
    expect(inventory.find((row) => row.itemId === item.id)).toBeUndefined();
  });

  it("正在裝備中的最後一件不能賣掉", async () => {
    const { user } = await createTestUser({ gold: 1000 });
    const weapon = await createTestItem({ type: "weapon", cost: 50, effectType: "attack", effectValue: 20 });
    await ItemService.buyItem(user.id, weapon.name); // 會自動裝備（空欄位）

    await expect(ItemService.sellItem(user.id, weapon.name)).rejects.toThrow("目前正在裝備中");
  });

  it("只有 1 個庫存時，兩個併發賣出只有一個會成功（競態測試）", async () => {
    const { user } = await createTestUser({ gold: 100 });
    const item = await createTestItem({ type: "potion", cost: 100, effectType: "heal" });
    await ItemService.buyItem(user.id, item.name); // 買完金幣剩 0

    const results = await Promise.allSettled([
      ItemService.sellItem(user.id, item.name),
      ItemService.sellItem(user.id, item.name),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // 只會賣掉一份，不會兩邊都拿到錢（金幣不會被灌成兩倍）
    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updatedUser.gold).toBe(50);
    const inventory = await ItemService.getInventory(user.id);
    expect(inventory.find((row) => row.itemId === item.id)).toBeUndefined();
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
      purchasable: false,
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

  it("一次使用多個藥水時，多份療效會疊加", async () => {
    const { user } = await createTestUser({ gold: 1000, health: 10, maxHealth: 200 });
    const potion = await createTestItem({ type: "potion", cost: 20, effectType: "heal", effectValue: 30 });
    await ItemService.buyItem(user.id, potion.name, 3);

    const result = await ItemService.useItem(user.id, potion.name, 3);

    expect(result.usedAmount).toBe(3);
    expect(result.healedAmount).toBe(90);
    expect(result.newHealth).toBe(100);
    const inventory = await ItemService.getInventory(user.id);
    expect(inventory.find((row) => row.itemId === potion.id)).toBeUndefined(); // 全部用完，該行應該被刪除
  });

  it("要求的數量超過回滿血量所需時，只用剛好回滿的數量，不浪費藥水", async () => {
    const { user } = await createTestUser({ gold: 1000, health: 90, maxHealth: 100 });
    const potion = await createTestItem({ type: "potion", cost: 20, effectType: "heal", effectValue: 30 });
    await ItemService.buyItem(user.id, potion.name, 5);

    const result = await ItemService.useItem(user.id, potion.name, 5);

    expect(result.usedAmount).toBe(1); // 差 10 點，1 瓶（+30）就回滿了，不用把 5 瓶都喝掉
    expect(result.requestedAmount).toBe(5);
    expect(result.newHealth).toBe(100);
    const inventory = await ItemService.getInventory(user.id);
    expect(inventory.find((row) => row.itemId === potion.id)?.quantity).toBe(4);
  });

  it("要求使用的數量超過庫存時拒絕", async () => {
    const { user } = await createTestUser({ gold: 1000, health: 10, maxHealth: 200 });
    const potion = await createTestItem({ type: "potion", cost: 20, effectType: "heal", effectValue: 30 });
    await ItemService.buyItem(user.id, potion.name, 2);

    await expect(ItemService.useItem(user.id, potion.name, 5)).rejects.toThrow("只有 2 個");
  });
});

describe("ItemService.equipItem", () => {
  it("三個飾品欄都滿了、沒指定要換哪一欄時，預設頂掉飾品欄 1", async () => {
    const { user } = await createTestUser({ gold: 1000 });
    const accA = await createTestItem({ type: "accessory", cost: 50, effectType: "attack", effectValue: 5 });
    const accB = await createTestItem({ type: "accessory", cost: 50, effectType: "defense", effectValue: 5 });
    const accC = await createTestItem({ type: "accessory", cost: 50, effectType: "maxHealth", effectValue: 10 });
    const accD = await createTestItem({ type: "accessory", cost: 50, effectType: "attack", effectValue: 8 });
    await ItemService.buyItem(user.id, accA.name); // 自動裝進 accessory1
    await ItemService.buyItem(user.id, accB.name); // 自動裝進 accessory2
    await ItemService.buyItem(user.id, accC.name); // 自動裝進 accessory3
    await ItemService.buyItem(user.id, accD.name); // 三欄都滿了，不會自動裝

    const result = await ItemService.equipItem(user.id, accD.name);

    expect(result.slot).toBe("accessory1");
    expect(result.replacedItem?.name).toBe(accA.name);
  });

  it("可以指定要換掉飾品欄 2，不會動到飾品欄 1、3", async () => {
    const { user } = await createTestUser({ gold: 1000 });
    const accA = await createTestItem({ type: "accessory", cost: 50, effectType: "attack", effectValue: 5 });
    const accB = await createTestItem({ type: "accessory", cost: 50, effectType: "defense", effectValue: 5 });
    const accC = await createTestItem({ type: "accessory", cost: 50, effectType: "maxHealth", effectValue: 10 });
    const accD = await createTestItem({ type: "accessory", cost: 50, effectType: "attack", effectValue: 8 });
    await ItemService.buyItem(user.id, accA.name); // accessory1
    await ItemService.buyItem(user.id, accB.name); // accessory2
    await ItemService.buyItem(user.id, accC.name); // accessory3
    await ItemService.buyItem(user.id, accD.name); // 三欄都滿了，不會自動裝

    const result = await ItemService.equipItem(user.id, accD.name, "accessory2");

    expect(result.slot).toBe("accessory2");
    expect(result.replacedItem?.name).toBe(accB.name);

    const equipped = await ItemService.getEquipped(user.id);
    expect(equipped.find((e) => e.slot === "accessory1")?.equipped?.item.name).toBe(accA.name);
    expect(equipped.find((e) => e.slot === "accessory3")?.equipped?.item.name).toBe(accC.name);
  });

  it("指定的欄位跟道具類型不相容時拒絕（例如武器指定裝到飾品欄）", async () => {
    const { user } = await createTestUser({ gold: 1000 });
    const weapon = await createTestItem({ type: "weapon", cost: 50, effectType: "attack", effectValue: 10 });
    await ItemService.buyItem(user.id, weapon.name);

    await expect(
      ItemService.equipItem(user.id, weapon.name, "accessory1")
    ).rejects.toThrow("不能裝到");
  });
});

describe("ItemService.getCraftableCatalog", () => {
  it("只回傳有配方的道具", async () => {
    const craftable = await createTestItem({
      recipe: [{ itemName: "隨便的材料", quantity: 1 }],
    });
    const notCraftable = await createTestItem();

    const catalog = await ItemService.getCraftableCatalog();
    const names = catalog.map((item) => item.name);

    expect(names).toContain(craftable.name);
    expect(names).not.toContain(notCraftable.name);
  });
});

describe("ItemService.craftItem", () => {
  it("材料足夠時，扣掉配方材料並把成品加進背包", async () => {
    const { user } = await createTestUser();
    const material = await createTestItem({ type: "material", purchasable: false });
    await prisma.inventory.create({ data: { userId: user.id, itemId: material.id, quantity: 5 } });
    const product = await createTestItem({
      type: "weapon",
      purchasable: false,
      effectType: "attack",
      effectValue: 50,
      recipe: [{ itemName: material.name, quantity: 3 }],
    });

    const result = await ItemService.craftItem(user.id, product.name);

    expect(result.quantity).toBe(1);
    const inventory = await ItemService.getInventory(user.id);
    expect(inventory.find((row) => row.itemId === material.id)?.quantity).toBe(2); // 5 - 3
    expect(inventory.find((row) => row.itemId === product.id)?.quantity).toBe(1);
  });

  it("材料不夠時拒絕鍛造，且不能扣掉一半材料", async () => {
    const { user } = await createTestUser();
    const material = await createTestItem({ type: "material", purchasable: false });
    await prisma.inventory.create({ data: { userId: user.id, itemId: material.id, quantity: 1 } });
    const product = await createTestItem({
      type: "weapon",
      purchasable: false,
      recipe: [{ itemName: material.name, quantity: 3 }],
    });

    await expect(ItemService.craftItem(user.id, product.name)).rejects.toThrow("材料不夠");

    // transaction 要整個回滾，手上的材料不能被扣掉
    const inventory = await ItemService.getInventory(user.id);
    expect(inventory.find((row) => row.itemId === material.id)?.quantity).toBe(1);
  });

  it("道具沒有配方時拒絕鍛造", async () => {
    const { user } = await createTestUser();
    const item = await createTestItem();

    await expect(ItemService.craftItem(user.id, item.name)).rejects.toThrow("沒有配方");
  });

  it("鍛造出武器時，空的武器欄會自動裝備", async () => {
    const { user } = await createTestUser();
    const material = await createTestItem({ type: "material", purchasable: false });
    await prisma.inventory.create({ data: { userId: user.id, itemId: material.id, quantity: 1 } });
    const weapon = await createTestItem({
      type: "weapon",
      purchasable: false,
      effectType: "attack",
      effectValue: 100,
      recipe: [{ itemName: material.name, quantity: 1 }],
    });

    const result = await ItemService.craftItem(user.id, weapon.name);

    expect(result.autoEquippedSlot).toBe("weapon");
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

  it("爆擊率/閃避率/金幣加成/經驗加成沒有基礎值，完全來自裝備", async () => {
    const { user } = await createTestUser({ gold: 1000 });
    const accessory = await createTestItem({
      type: "accessory",
      cost: 50,
      effectType: "critRate",
      effectValue: 15,
    });
    await ItemService.buyItem(user.id, accessory.name);

    const stats = await ItemService.getEffectiveStats(user.id, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });

    expect(stats.critRate).toBe(15);
    expect(stats.dodgeRate).toBe(0);
    expect(stats.goldBonus).toBe(0);
    expect(stats.xpBonus).toBe(0);
  });

  it("神話級道具的第二種效果（effectType2/effectValue2）也要算進有效屬性", async () => {
    const { user } = await createTestUser({ gold: 1000, attack: 10 });
    const weapon = await createTestItem({
      type: "weapon",
      cost: 50,
      effectType: "attack",
      effectValue: 100,
      recipe: [{ itemName: "隨便的材料", quantity: 1 }],
    });
    // effectType2/effectValue2 不在 createTestItem 的 overrides 型別裡，直接補寫更新
    await prisma.item.update({
      where: { id: weapon.id },
      data: { effectType2: "critRate", effectValue2: 20 },
    });
    await ItemService.buyItem(user.id, weapon.name);

    const stats = await ItemService.getEffectiveStats(user.id, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });

    expect(stats.attack).toBe(110);
    expect(stats.critRate).toBe(20);
  });
});
