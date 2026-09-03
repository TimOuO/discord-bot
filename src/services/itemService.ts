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

// 背包顯示順序：裝備類優先（武器/防具/飾品），再來是消耗品，最後才是魚/材料；
// 原本用 Prisma 的 orderBy type asc 是照字母排序，weapon 剛好排最後面，武器反而被擠到最後一頁
export const TYPE_ORDER: readonly string[] = ["weapon", "armor", "accessory", "potion", "fish", "material"];

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

// 背包列表拿來標「跟現在裝備比差多少」用，例如 (+15) 或 (-5) 或 (±0)
export function formatEffectDelta(type: string, delta: number): string {
  const suffix = PERCENTAGE_EFFECT_TYPES.includes(type) ? "%" : "";
  if (delta === 0) return `±0${suffix}`;
  return `${delta > 0 ? "+" : ""}${delta}${suffix}`;
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
  // 只有 purchasable 的道具才會出現在商店（魚/材料/鍛造裝備都不能直接買，見 sellItem 之後可以拿去賣）；
  // 排序照 TYPE_ORDER（裝備優先），不是字母順序，同類型內再照價格排
  static async getShopCatalog(): Promise<Item[]> {
    const items = await prisma.item.findMany({
      where: { purchasable: true },
      orderBy: [{ cost: "asc" }],
    });
    return items.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  }

  // 有配方的道具才能鍛造；排序照 TYPE_ORDER（裝備優先），同類型內再照價格排
  static async getCraftableCatalog(): Promise<Item[]> {
    const items = await prisma.item.findMany({
      where: { recipe: { not: Prisma.DbNull } },
      orderBy: [{ cost: "asc" }],
    });
    return items.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  }

  static async findItemByName(name: string): Promise<Item | null> {
    return prisma.item.findUnique({ where: { name } });
  }

  // 每一件賣掉能拿到的金幣：商店買得到的道具打五折，不能買的道具（沒有商店售價）全額賣出
  static getSellPricePerUnit(item: Item): number {
    const ratio = item.purchasable ? SELL_PRICE_RATIO : 1;
    return Math.floor(item.cost * ratio);
  }

  // 排序照 TYPE_ORDER（裝備優先），不是字母順序；Prisma 的 orderBy 沒辦法表示自訂順序，
  // 用 JS 排序，資料量小（一個玩家的背包）效能不是問題
  static async getInventory(userInternalId: string) {
    const rows = await prisma.inventory.findMany({
      where: { userId: userInternalId },
      include: { item: true },
    });
    return rows.sort((a, b) => TYPE_ORDER.indexOf(a.item.type) - TYPE_ORDER.indexOf(b.item.type));
  }

  static async getEquipped(userInternalId: string) {
    const rows = await prisma.equippedItem.findMany({
      where: { userId: userInternalId },
      include: { item: true },
    });
    const bySlot = new Map(rows.map((row) => [row.slot, row]));
    return EQUIP_SLOTS.map((slot) => ({ slot, equipped: bySlot.get(slot) ?? null }));
  }

  // 跟目前裝備比較數值差異，給商店/鍛造/背包清單共用：武器/防具只有一個對應欄位，直接比；
  // 飾品有三欄，同屬性的話跟其中最弱的比，沒有同屬性的裝備就不比、只顯示這件道具本身的數值
  static computeEquipComparison(
    itemType: string,
    item: { effectType: string; effectType2?: string | null; effectValue: number; effectValue2?: number | null },
    equipped: Awaited<ReturnType<typeof ItemService.getEquipped>>
  ): string {
    const candidateEffects: { type: string; value: number }[] = [{ type: item.effectType, value: item.effectValue }];
    if (item.effectType2 && item.effectValue2 != null) {
      candidateEffects.push({ type: item.effectType2, value: item.effectValue2 });
    }

    const referenceSlots: string[] =
      itemType === "weapon" ? ["weapon"] : itemType === "armor" ? ["armor"] : itemType === "accessory" ? [...ACCESSORY_SLOTS] : [];

    const referenceEffects: { type: string; value: number }[] = [];
    for (const slot of referenceSlots) {
      const eq = equipped.find((e) => e.slot === slot)?.equipped;
      if (!eq) continue;
      referenceEffects.push({ type: eq.item.effectType, value: eq.item.effectValue });
      if (eq.item.effectType2 && eq.item.effectValue2 != null) {
        referenceEffects.push({ type: eq.item.effectType2, value: eq.item.effectValue2 });
      }
    }

    const parts = candidateEffects.map(({ type, value }) => {
      const matches = referenceEffects.filter((r) => r.type === type);
      if (matches.length === 0) return formatEffectValue(type, value);
      const weakest = matches.reduce((min, m) => (m.value < min.value ? m : min));
      return `${formatEffectValue(type, value)}（${formatEffectDelta(type, value - weakest.value)}）`;
    });

    return parts.join("、");
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

  static async buyItem(userInternalId: string, itemName: string, amount = 1) {
    if (amount < 1) throw new Error("購買數量至少要 1 個");

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

    const totalCost = item.cost * amount;

    // 金幣夠不夠的判斷跟扣款包在同一個 conditional update 裡（where 直接帶 gold >= totalCost），
    // 不會有「查完錢夠、扣款前錢被別的操作花掉」的競態；count 是 0 就代表搶輸了，重新查一次目前金幣來報錯
    const inventory = await prisma.$transaction(async (tx) => {
      const claimed = await tx.user.updateMany({
        where: { id: userInternalId, gold: { gte: totalCost } },
        data: { gold: { decrement: totalCost } },
      });
      if (claimed.count === 0) {
        const user = await tx.user.findUniqueOrThrow({ where: { id: userInternalId } });
        throw new Error(
          `金幣不夠，「${item.name}」x${amount} 要 ${totalCost} 金幣，你只有 ${user.gold} 金幣`
        );
      }

      return tx.inventory.upsert({
        where: { userId_itemId: { userId: userInternalId, itemId: item.id } },
        create: { userId: userInternalId, itemId: item.id, quantity: amount },
        update: { quantity: { increment: amount } },
      });
    });

    const autoEquipped = await this.maybeAutoEquip(userInternalId, item);
    return { item, quantity: inventory.quantity, boughtAmount: amount, totalCost, autoEquippedSlot: autoEquipped?.slot ?? null };
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

  // public：inventory.ts 要在「賣出」按鈕上直接標出可賣數量/總價（裝備中的不算），不用等按下去才知道
  static async getSellableQuantity(userInternalId: string, itemId: string): Promise<number> {
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

    // 賣出的扣減也包成 conditional update：where 直接要求「剩下的量還是要 >= 裝備中的數量」，
    // 不會有「查完可賣數量、真的扣之前庫存已經被別的操作動過」的競態（例如兩個賣出請求同時打進來）
    const equippedCount = await prisma.equippedItem.count({
      where: { userId: userInternalId, itemId: item.id },
    });

    const [updatedUser] = await prisma.$transaction(async (tx) => {
      const claimed = await tx.inventory.updateMany({
        where: { id: inventory.id, quantity: { gte: amount + equippedCount } },
        data: { quantity: { decrement: amount } },
      });
      if (claimed.count === 0) {
        throw new Error(`「${item.name}」的庫存在賣出前被其他操作改變了，請重新查詢後再試`);
      }

      // 扣完剛好歸零的話刪掉這筆庫存紀錄，不留 quantity=0 的殘影（背包列表會顯示出一筆「x0」的道具）
      await tx.inventory.deleteMany({ where: { id: inventory.id, quantity: { lte: 0 } } });

      const user = await tx.user.update({
        where: { id: userInternalId },
        data: { gold: { increment: sellPrice } },
      });
      return [user];
    });

    return { item, sellPrice, amount, goldAfter: updatedUser.gold };
  }

  // amount 是玩家「最多」想用幾個；實際消耗會封頂在「回滿血量所需的數量」，
  // 不會因為選太多而白白浪費藥水（usedAmount 可能小於 amount，回傳給呼叫端顯示用）
  static async useItem(userInternalId: string, itemName: string, amount = 1) {
    if (amount < 1) throw new Error("使用數量至少要 1 個");

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
    if (amount > inventory.quantity) {
      throw new Error(`「${item.name}」只有 ${inventory.quantity} 個，不能使用 ${amount} 個`);
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

    const neededToFull = effectiveStats.maxHealth - user.health;
    const potionsNeeded = Math.max(1, Math.ceil(neededToFull / item.effectValue));
    const usedAmount = Math.min(amount, potionsNeeded);

    const newHealth = Math.min(user.health + item.effectValue * usedAmount, effectiveStats.maxHealth);
    const healedAmount = newHealth - user.health;

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userInternalId }, data: { health: newHealth } });
      if (inventory.quantity - usedAmount <= 0) {
        await tx.inventory.delete({ where: { id: inventory.id } });
      } else {
        await tx.inventory.update({
          where: { id: inventory.id },
          data: { quantity: { decrement: usedAmount } },
        });
      }
    });

    return { item, healedAmount, newHealth, maxHealth: effectiveStats.maxHealth, usedAmount, requestedAmount: amount };
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
