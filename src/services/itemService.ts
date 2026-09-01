import { Item, Prisma } from "../generated/prisma";
import prisma from "./dbService";

export const EQUIP_SLOTS = ["weapon", "armor", "accessory1", "accessory2", "accessory3"] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

export const EQUIPPABLE_TYPES: readonly string[] = ["weapon", "armor", "accessory"];
// 商店買得到的道具賣掉打五折（正常經濟消耗）；不能買的道具（魚、材料、鍛造裝備）沒有商店售價可言，
// Item.cost 對它們來說只是「參考價值」不是玩家真的付過的錢，所以賣這些不打折
const SELL_PRICE_RATIO = 0.5;

export interface RecipeIngredient {
  itemName: string;
  quantity: number;
}

export const TYPE_LABELS: Record<string, string> = {
  weapon: "武器",
  armor: "防具",
  accessory: "飾品",
  potion: "藥水",
  fish: "魚類",
  material: "材料",
};

export const TYPE_EMOJIS: Record<string, string> = {
  weapon: "⚔️",
  armor: "🛡️",
  accessory: "💍",
  potion: "🧪",
  fish: "🐟",
  material: "⛏️",
};

export const EFFECT_TYPE_LABELS: Record<string, string> = {
  attack: "攻擊力",
  defense: "防禦力",
  maxHealth: "生命上限",
  heal: "回復生命",
  critRate: "爆擊率",
  dodgeRate: "閃避率",
  goldBonus: "金幣加成",
  xpBonus: "經驗加成",
};

// 這幾種效果的 effectValue 代表百分比（+N%），顯示時要加 % 而不是當成純數值
const PERCENTAGE_EFFECT_TYPES: readonly string[] = ["critRate", "dodgeRate", "goldBonus", "xpBonus"];

export function formatEffectValue(type: string, value: number): string {
  const label = EFFECT_TYPE_LABELS[type] ?? type;
  const suffix = PERCENTAGE_EFFECT_TYPES.includes(type) ? "%" : "";
  return `${label} +${value}${suffix}`;
}

export const RARITY_LABELS: Record<string, string> = {
  common: "普通",
  uncommon: "不常見",
  rare: "稀有",
  epic: "史詩",
  legendary: "傳說",
  mythic: "神話",
};

export const SLOT_LABELS: Record<EquipSlot, string> = {
  weapon: "武器",
  armor: "防具",
  accessory1: "飾品欄 1",
  accessory2: "飾品欄 2",
  accessory3: "飾品欄 3",
};

// 飾品欄 1/2/3 對玩家來說沒有實質差異（純粹是系統內部用來分開存三件飾品），
// 使用者看到的文字不用管是哪一欄，只需要知道「這是飾品」；武器/防具則本來就是不同東西，維持原本標籤
export const SLOT_GROUP_LABELS: Record<EquipSlot, string> = {
  weapon: "武器",
  armor: "防具",
  accessory1: "飾品",
  accessory2: "飾品",
  accessory3: "飾品",
};

// 飾品欄的順序，挑空欄位/判斷是否全滿都照這個順序
export const ACCESSORY_SLOTS: readonly EquipSlot[] = ["accessory1", "accessory2", "accessory3"];

export interface EffectiveStats {
  attack: number;
  defense: number;
  maxHealth: number;
  critRate: number; // 爆擊率，百分比（0-100）
  dodgeRate: number; // 閃避率，百分比（0-100）
  goldBonus: number; // 金幣加成，百分比（0-100）
  xpBonus: number; // 經驗加成，百分比（0-100）
}

export interface BaseStats {
  attack: number;
  defense: number;
  maxHealth: number;
}

export class ItemService {
  // 只有 purchasable 的道具才會出現在商店（魚/材料/鍛造裝備都不能直接買，見 sellItem 之後可以拿去賣）
  static async getShopCatalog(): Promise<Item[]> {
    return prisma.item.findMany({
      where: { purchasable: true },
      orderBy: [{ type: "asc" }, { cost: "asc" }],
    });
  }

  // 有配方的道具才能鍛造
  static async getCraftableCatalog(): Promise<Item[]> {
    return prisma.item.findMany({
      where: { recipe: { not: Prisma.DbNull } },
      orderBy: [{ cost: "asc" }],
    });
  }

  static async findItemByName(name: string): Promise<Item | null> {
    return prisma.item.findUnique({ where: { name } });
  }

  // 每一件賣掉能拿到的金幣：商店買得到的道具打五折，不能買的道具（沒有商店售價）全額賣出
  static getSellPricePerUnit(item: Item): number {
    const ratio = item.purchasable ? SELL_PRICE_RATIO : 1;
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
  // 爆擊率/閃避率/金幣加成/經驗加成沒有對應的 User 基礎欄位，一律從 0 開始、純粹來自裝備
  static async getEffectiveStats(
    userInternalId: string,
    base: BaseStats
  ): Promise<EffectiveStats> {
    const rows = await prisma.equippedItem.findMany({
      where: { userId: userInternalId },
      include: { item: true },
    });

    const result: EffectiveStats = { ...base, critRate: 0, dodgeRate: 0, goldBonus: 0, xpBonus: 0 };
    const applyEffect = (type: string, value: number) => {
      if (type === "attack") result.attack += value;
      else if (type === "defense") result.defense += value;
      else if (type === "maxHealth") result.maxHealth += value;
      else if (type === "critRate") result.critRate += value;
      else if (type === "dodgeRate") result.dodgeRate += value;
      else if (type === "goldBonus") result.goldBonus += value;
      else if (type === "xpBonus") result.xpBonus += value;
    };

    for (const row of rows) {
      applyEffect(row.item.effectType, row.item.effectValue);
      // 神話級鍛造裝備才會有第二種效果，一般道具的 effectType2 是 null
      if (row.item.effectType2 && row.item.effectValue2 != null) {
        applyEffect(row.item.effectType2, row.item.effectValue2);
      }
    }
    return result;
  }

  static async buyItem(userInternalId: string, itemName: string) {
    const item = await this.findItemByName(itemName);
    if (!item) throw new Error(`商店裡沒有「${itemName}」這件道具`);
    if (!item.purchasable) {
      const hint =
        item.type === "fish" ? "要自己去 /rpg fish 釣"
        : item.type === "material" ? "要自己去 /rpg gather 採集"
        : item.recipe ? "要用 /rpg craft 鍛造"
        : "沒辦法用金幣取得";
      throw new Error(`「${item.name}」不是商店販售的商品，${hint}才拿得到！`);
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
      const hasEmptySlot = ACCESSORY_SLOTS.some((slot) => !occupiedSlots.has(slot));
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

    const [updatedUser] = await prisma.$transaction([
      prisma.user.update({
        where: { id: userInternalId },
        data: { gold: { increment: sellPrice } },
      }),
      inventory.quantity - amount <= 0
        ? prisma.inventory.delete({ where: { id: inventory.id } })
        : prisma.inventory.update({
            where: { id: inventory.id },
            data: { quantity: { decrement: amount } },
          }),
    ]);

    return { item, sellPrice, amount, goldAfter: updatedUser.gold };
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

  // preferredSlot 給飾品指定要換掉 accessory1 還是 accessory2；不指定時維持原本「優先塞空格，
  // 兩格都滿了預設頂掉 accessory1」的自動邏輯（武器/防具本來就只有一個對應欄位，不受這個參數影響）
  static async equipItem(userInternalId: string, itemName: string, preferredSlot?: EquipSlot) {
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

    const validSlotsForType: Record<string, EquipSlot[]> = {
      weapon: ["weapon"],
      armor: ["armor"],
      accessory: [...ACCESSORY_SLOTS],
    };

    let targetSlot: EquipSlot;
    if (preferredSlot) {
      if (!validSlotsForType[item.type]?.includes(preferredSlot)) {
        throw new Error(`「${item.name}」不能裝到${SLOT_LABELS[preferredSlot]}`);
      }
      targetSlot = preferredSlot;
    } else if (item.type === "weapon") {
      targetSlot = "weapon";
    } else if (item.type === "armor") {
      targetSlot = "armor";
    } else {
      // 飾品：優先塞空格，三格都滿了預設頂掉 accessory1
      const occupiedSlots = new Set(equippedRows.map((row) => row.slot));
      targetSlot = ACCESSORY_SLOTS.find((slot) => !occupiedSlots.has(slot)) ?? "accessory1";
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

  // 鍛造：扣掉配方要求的每種材料、把鍛造出來的道具加進背包，整個在一個 transaction 裡完成，
  // 材料不夠時直接拋錯讓 transaction 自動回滾，不會扣一半材料才發現做不出來
  static async craftItem(userInternalId: string, itemName: string) {
    const item = await this.findItemByName(itemName);
    if (!item) throw new Error(`「${itemName}」不是有效的道具名稱`);
    if (!item.recipe) throw new Error(`「${item.name}」沒有配方，沒辦法鍛造`);

    const ingredients = item.recipe as unknown as RecipeIngredient[];

    await prisma.$transaction(async (tx) => {
      for (const ingredient of ingredients) {
        const ingredientItem = await tx.item.findUnique({ where: { name: ingredient.itemName } });
        if (!ingredientItem) {
          throw new Error(`配方設定錯誤：找不到材料「${ingredient.itemName}」`);
        }

        const inv = await tx.inventory.findUnique({
          where: { userId_itemId: { userId: userInternalId, itemId: ingredientItem.id } },
        });
        const have = inv?.quantity ?? 0;
        if (have < ingredient.quantity) {
          throw new Error(
            `材料不夠：「${ingredient.itemName}」還差 ${ingredient.quantity - have} 個`
          );
        }

        if (have - ingredient.quantity <= 0) {
          await tx.inventory.delete({ where: { id: inv!.id } });
        } else {
          await tx.inventory.update({
            where: { id: inv!.id },
            data: { quantity: { decrement: ingredient.quantity } },
          });
        }
      }

      await tx.inventory.upsert({
        where: { userId_itemId: { userId: userInternalId, itemId: item.id } },
        create: { userId: userInternalId, itemId: item.id, quantity: 1 },
        update: { quantity: { increment: 1 } },
      });
    });

    const inventory = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId: userInternalId, itemId: item.id } },
    });

    const autoEquipped = await this.maybeAutoEquip(userInternalId, item);
    return { item, quantity: inventory?.quantity ?? 1, autoEquippedSlot: autoEquipped?.slot ?? null };
  }
}
