import { Item } from "../generated/prisma";
import prisma from "./dbService";

export const EQUIP_SLOTS = ["weapon", "armor", "accessory1", "accessory2"] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

const EQUIPPABLE_TYPES: readonly string[] = ["weapon", "armor", "accessory"];
// 商店買得到的道具賣掉打五折（正常經濟消耗）；釣到的魚沒有商店售價可言，
// Item.cost 對魚類來說只是「參考價值」不是玩家真的付過的錢，所以賣魚不打折
const NON_PURCHASABLE_TYPES: readonly string[] = ["fish"];
const SELL_PRICE_RATIO = 0.5;

export const TYPE_LABELS: Record<string, string> = {
  weapon: "武器",
  armor: "防具",
  accessory: "飾品",
  potion: "藥水",
  fish: "魚類",
};

export const TYPE_EMOJIS: Record<string, string> = {
  weapon: "⚔️",
  armor: "🛡️",
  accessory: "💍",
  potion: "🧪",
  fish: "🐟",
};

export const EFFECT_TYPE_LABELS: Record<string, string> = {
  attack: "攻擊力",
  defense: "防禦力",
  maxHealth: "生命上限",
  heal: "回復生命",
};

export const RARITY_LABELS: Record<string, string> = {
  common: "普通",
  uncommon: "不常見",
  rare: "稀有",
  epic: "史詩",
  legendary: "傳說",
};

export const SLOT_LABELS: Record<EquipSlot, string> = {
  weapon: "武器",
  armor: "防具",
  accessory1: "飾品欄 1",
  accessory2: "飾品欄 2",
};

export interface EffectiveStats {
  attack: number;
  defense: number;
  maxHealth: number;
}

export class ItemService {
  // 魚類只能靠 /rpg fish 釣，不放進商店可購買清單（見 sellItem 之後可以拿去賣）
  static async getShopCatalog(): Promise<Item[]> {
    return prisma.item.findMany({
      where: { type: { notIn: [...NON_PURCHASABLE_TYPES] } },
      orderBy: [{ type: "asc" }, { cost: "asc" }],
    });
  }

  static async findItemByName(name: string): Promise<Item | null> {
    return prisma.item.findUnique({ where: { name } });
  }

  // 每一件賣掉能拿到的金幣：商店買得到的道具打五折，釣到的魚（沒有商店售價）全額賣出
  static getSellPricePerUnit(item: Item): number {
    const ratio = NON_PURCHASABLE_TYPES.includes(item.type) ? 1 : SELL_PRICE_RATIO;
    return Math.floor(item.cost * ratio);
  }

  static async getInventory(userInternalId: string) {
    return prisma.inventory.findMany({
      where: { userId: userInternalId },
      include: { item: true },
      orderBy: { item: { type: "asc" } },
    });
  }

  static async getEquipped(userInternalId: string) {
    const rows = await prisma.equippedItem.findMany({
      where: { userId: userInternalId },
      include: { item: true },
    });
    const bySlot = new Map(rows.map((row) => [row.slot, row]));
    return EQUIP_SLOTS.map((slot) => ({ slot, equipped: bySlot.get(slot) ?? null }));
  }

  // 有效屬性 = 基礎屬性 + 目前所有已裝備道具的加成，即時計算、不寫回 User（見 docs/adr/0001）
  static async getEffectiveStats(
    userInternalId: string,
    base: EffectiveStats
  ): Promise<EffectiveStats> {
    const rows = await prisma.equippedItem.findMany({
      where: { userId: userInternalId },
      include: { item: true },
    });

    const result = { ...base };
    for (const row of rows) {
      if (row.item.effectType === "attack") result.attack += row.item.effectValue;
      else if (row.item.effectType === "defense") result.defense += row.item.effectValue;
      else if (row.item.effectType === "maxHealth") result.maxHealth += row.item.effectValue;
    }
    return result;
  }

  static async buyItem(userInternalId: string, itemName: string) {
    const item = await this.findItemByName(itemName);
    if (!item) throw new Error(`商店裡沒有「${itemName}」這件道具`);
    if (NON_PURCHASABLE_TYPES.includes(item.type)) {
      throw new Error(`「${item.name}」不是商店販售的商品，要自己去 /rpg fish 釣才拿得到！`);
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userInternalId } });
    if (user.gold < item.cost) {
      throw new Error(
        `金幣不夠，「${item.name}」要 ${item.cost} 金幣，你只有 ${user.gold} 金幣`
      );
    }

    const [, inventory] = await prisma.$transaction([
      prisma.user.update({
        where: { id: userInternalId },
        data: { gold: { decrement: item.cost } },
      }),
      prisma.inventory.upsert({
        where: { userId_itemId: { userId: userInternalId, itemId: item.id } },
        create: { userId: userInternalId, itemId: item.id, quantity: 1 },
        update: { quantity: { increment: 1 } },
      }),
    ]);

    const autoEquipped = await this.maybeAutoEquip(userInternalId, item);
    return { item, quantity: inventory.quantity, autoEquippedSlot: autoEquipped?.slot ?? null };
  }

  // 買到裝備時自動判斷要不要裝上：
  // - 武器/防具：該欄位是空的就直接裝；有東西的話只有比現在強（effectValue 更高）才換上
  // - 飾品：兩個效果類型不一定能比大小，只有還有空欄位時才自動裝，兩格都滿了就不自動處理
  private static async maybeAutoEquip(
    userInternalId: string,
    item: Item
  ): Promise<{ slot: EquipSlot } | null> {
    if (item.type === "weapon" || item.type === "armor") {
      const slot: EquipSlot = item.type === "weapon" ? "weapon" : "armor";
      const current = await prisma.equippedItem.findUnique({
        where: { userId_slot: { userId: userInternalId, slot } },
        include: { item: true },
      });

      const shouldEquip = !current || item.effectValue > current.item.effectValue;
      if (!shouldEquip) return null;

      const result = await this.equipItem(userInternalId, item.name);
      return { slot: result.slot };
    }

    if (item.type === "accessory") {
      const equippedRows = await prisma.equippedItem.findMany({
        where: { userId: userInternalId },
      });
      const occupiedSlots = new Set(equippedRows.map((row) => row.slot));
      const hasEmptySlot = !occupiedSlots.has("accessory1") || !occupiedSlots.has("accessory2");
      if (!hasEmptySlot) return null;

      const result = await this.equipItem(userInternalId, item.name);
      return { slot: result.slot };
    }

    return null;
  }

  static async sellItem(userInternalId: string, itemName: string, amount = 1) {
    if (amount < 1) throw new Error("賣出數量至少要 1 個");

    const item = await this.findItemByName(itemName);
    if (!item) throw new Error(`「${itemName}」不是有效的道具名稱`);

    return this.sellItemQuantity(userInternalId, item, amount);
  }

  // 賣掉「賣得動的全部數量」，裝備中的那幾件會自動排除、不會賣到
  static async sellAllOfItem(userInternalId: string, itemName: string) {
    const item = await this.findItemByName(itemName);
    if (!item) throw new Error(`「${itemName}」不是有效的道具名稱`);

    const sellableQuantity = await this.getSellableQuantity(userInternalId, item.id);
    if (sellableQuantity <= 0) {
      throw new Error(`「${item.name}」目前全部都在裝備中，沒有可以賣的`);
    }

    return this.sellItemQuantity(userInternalId, item, sellableQuantity);
  }

  private static async getSellableQuantity(userInternalId: string, itemId: string): Promise<number> {
    const inventory = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId: userInternalId, itemId } },
    });
    if (!inventory) return 0;

    // 賣掉後剩下的數量，不能少於目前裝備中引用這件道具的欄位數
    const equippedCount = await prisma.equippedItem.count({
      where: { userId: userInternalId, itemId },
    });
    return inventory.quantity - equippedCount;
  }

  private static async sellItemQuantity(userInternalId: string, item: Item, amount: number) {
    const inventory = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId: userInternalId, itemId: item.id } },
    });
    if (!inventory || inventory.quantity <= 0) {
      throw new Error(`你沒有「${item.name}」可以賣`);
    }

    const sellableQuantity = await this.getSellableQuantity(userInternalId, item.id);
    if (amount > sellableQuantity) {
      if (sellableQuantity <= 0) {
        throw new Error(
          `「${item.name}」目前正在裝備中，無法賣掉最後一件，請先換裝再賣`
        );
      }
      throw new Error(
        `「${item.name}」最多只能賣 ${sellableQuantity} 個（裝備中的不能賣掉最後一件）`
      );
    }

    const sellPrice = this.getSellPricePerUnit(item) * amount;

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userInternalId },
        data: { gold: { increment: sellPrice } },
      });
      if (inventory.quantity - amount <= 0) {
        await tx.inventory.delete({ where: { id: inventory.id } });
      } else {
        await tx.inventory.update({
          where: { id: inventory.id },
          data: { quantity: { decrement: amount } },
        });
      }
    });

    return { item, sellPrice, amount };
  }

  static async useItem(userInternalId: string, itemName: string) {
    const item = await this.findItemByName(itemName);
    if (!item) throw new Error(`「${itemName}」不是有效的道具名稱`);
    if (item.type !== "potion") {
      throw new Error(`「${item.name}」不是可以使用的消耗品`);
    }

    const inventory = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId: userInternalId, itemId: item.id } },
    });
    if (!inventory || inventory.quantity <= 0) {
      throw new Error(`你沒有「${item.name}」可以使用`);
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userInternalId } });
    const effectiveStats = await this.getEffectiveStats(userInternalId, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });

    if (user.health >= effectiveStats.maxHealth) {
      throw new Error(
        `生命值已經是滿的（${user.health}/${effectiveStats.maxHealth}），不需要使用`
      );
    }

    const newHealth = Math.min(user.health + item.effectValue, effectiveStats.maxHealth);
    const healedAmount = newHealth - user.health;

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userInternalId }, data: { health: newHealth } });
      if (inventory.quantity - 1 <= 0) {
        await tx.inventory.delete({ where: { id: inventory.id } });
      } else {
        await tx.inventory.update({
          where: { id: inventory.id },
          data: { quantity: { decrement: 1 } },
        });
      }
    });

    return { item, healedAmount, newHealth, maxHealth: effectiveStats.maxHealth };
  }

  static async equipItem(userInternalId: string, itemName: string) {
    const item = await this.findItemByName(itemName);
    if (!item) throw new Error(`「${itemName}」不是有效的道具名稱`);
    if (!EQUIPPABLE_TYPES.includes(item.type)) {
      throw new Error(`「${item.name}」不是可以裝備的道具`);
    }

    const inventory = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId: userInternalId, itemId: item.id } },
    });
    if (!inventory || inventory.quantity <= 0) {
      throw new Error(`你沒有「${item.name}」可以裝備`);
    }

    const equippedRows = await prisma.equippedItem.findMany({
      where: { userId: userInternalId },
    });
    const equippedCountOfThisItem = equippedRows.filter(
      (row) => row.itemId === item.id
    ).length;

    let targetSlot: EquipSlot;
    if (item.type === "weapon") {
      targetSlot = "weapon";
    } else if (item.type === "armor") {
      targetSlot = "armor";
    } else {
      // 飾品：優先塞空格，兩格都滿了預設頂掉 accessory1
      const occupiedSlots = new Set(equippedRows.map((row) => row.slot));
      targetSlot = !occupiedSlots.has("accessory1")
        ? "accessory1"
        : !occupiedSlots.has("accessory2")
          ? "accessory2"
          : "accessory1";
    }

    const currentInTargetSlot = equippedRows.find((row) => row.slot === targetSlot);
    const willReplaceSameItem = currentInTargetSlot?.itemId === item.id;

    // 換到新欄位（不是原地重複裝同一件）時，手上剩下的數量要夠：已經佔用在其他欄位的不能重複算
    if (!willReplaceSameItem && inventory.quantity <= equippedCountOfThisItem) {
      throw new Error(
        `「${item.name}」的數量不夠再裝到別的欄位（已經有其他欄位在用了）`
      );
    }

    const replacedItem = currentInTargetSlot && !willReplaceSameItem
      ? await prisma.item.findUnique({ where: { id: currentInTargetSlot.itemId } })
      : null;

    await prisma.equippedItem.upsert({
      where: { userId_slot: { userId: userInternalId, slot: targetSlot } },
      create: { userId: userInternalId, itemId: item.id, slot: targetSlot },
      update: { itemId: item.id },
    });

    return { item, slot: targetSlot, replacedItem };
  }
}
