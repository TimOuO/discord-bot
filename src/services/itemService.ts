import { Item, Prisma } from "../generated/prisma";
import { randomChance } from "../utils/random";
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

// 強化每一級讓裝備的效果值 +10%（+10 就是兩倍）。強化等級掛在 ItemInstance 上，
// 所以同名裝備可以有 +7 跟 +0 兩件、各自算各自的
export const ENHANCE_BONUS_PER_LEVEL = 0.1;
export const MAX_ENHANCE_LEVEL = 10;

export function enhancedValue(baseValue: number, enhanceLevel: number): number {
  return Math.round(baseValue * (1 + enhanceLevel * ENHANCE_BONUS_PER_LEVEL));
}

// 強化到第 N 級的成功率。前段幾乎穩過、後段才開始有賭的成分，
// 因為 +5（裝備數值 ×1.5）就足以解決「裝備固定值追不上敵人線性成長」的問題（見 PRD 第 15 節的模擬），
// +6 之後純粹是給願意投入的人的選配追求，不是正常遊玩的門檻
const ENHANCE_SUCCESS_RATE: Record<number, number> = {
  1: 0.95, 2: 0.9, 3: 0.85, 4: 0.8, 5: 0.75,
  6: 0.6, 7: 0.5, 8: 0.4, 9: 0.35, 10: 0.3,
};

// 這一級（含）以上，失敗會退一級；以下失敗只損失費用、等級原地不動。
// 刻意不設「摧毀裝備」——花好幾小時鍛造出來的神話裝一發沒了，對這個規模的伺服器只會勸退
const ENHANCE_LEVEL_LOSS_FROM = 6;

// 每次強化的費用固定是道具價格的 10%：貴重裝備強化成本自然更高，
// 但新手也能在便宜裝備上玩得起（木劍每次只要 5 金幣）
const ENHANCE_COST_RATIO = 0.1;

export function enhanceSuccessRate(targetLevel: number): number {
  return ENHANCE_SUCCESS_RATE[targetLevel] ?? 0;
}

export function enhanceCost(item: Item): number {
  return Math.max(1, Math.round(item.cost * ENHANCE_COST_RATIO));
}

/** 強化失敗時會不會掉一級（+6 以上才會） */
export function enhanceFailureDropsLevel(targetLevel: number): boolean {
  return targetLevel >= ENHANCE_LEVEL_LOSS_FROM;
}

// +6 以上除了金幣還要付材料。動機是金幣對後期玩家早就不是門檻（Lv74 的玩家握著 9 萬金幣、
// 夠買 138 次強化），而材料除了鍛造之外沒有任何出口，囤到 91 個史詩／22 個傳說放著長灰塵。
// 收材料等於把「釣魚/採集/菁英怪/地下城」的產出接回強化這個無底洞，讓後期的瓶頸從金幣換成產出循環。
//
// 只認 fish / material 兩種型別——藥水也有 epic/legendary 稀有度（極品生命藥水、聖光藥水），
// 沒有這道過濾的話「扣庫存最多的」會優先把玩家的補血藥水拿去燒掉
export const ENHANCE_MATERIAL_TYPES: readonly string[] = ["fish", "material"];

// 裝備稀有度 -> [低階材料稀有度, 高階材料稀有度]。
// 材料階級跟著裝備縮放而不是一律收史詩，有兩個好處：新手的木劍不會卡在拿不到史詩材料，
// 而 common/uncommon 材料（完全沒有配方在用，玩家囤了 50 幾根樹枝）也終於有了出口。
// 想強化的本來就都是神話裝，所以主要的消耗目標仍然是史詩/傳說材料
const ENHANCE_MATERIAL_TIERS: Record<string, readonly [string, string]> = {
  common: ["common", "uncommon"],
  uncommon: ["common", "uncommon"],
  rare: ["uncommon", "rare"],
  epic: ["rare", "epic"],
  legendary: ["rare", "epic"],
  mythic: ["epic", "legendary"],
};

// 目標等級 -> [用低階(0)還是高階(1), 幾個]。沒列到的等級（+1~+5）不收材料。
// 這條階梯是用 20 萬次蒙地卡羅模擬挑出來的：一件神話裝 +0→+10 平均吃掉 80 個史詩 + 13 個傳說，
// 恰好是目前最高等玩家的整份庫存——盈餘被清空、但推得完一件
const ENHANCE_MATERIAL_LADDER: Record<number, readonly [0 | 1, number]> = {
  6: [0, 1],
  7: [0, 1],
  8: [0, 2],
  9: [1, 1],
  10: [1, 1],
};

export interface EnhanceMaterialRequirement {
  rarity: string;
  quantity: number;
}

/** 強化到第 N 級要付的材料；+5 以下只收金幣，回傳 null */
export function enhanceMaterialRequirement(
  item: Item,
  targetLevel: number
): EnhanceMaterialRequirement | null {
  const ladder = ENHANCE_MATERIAL_LADDER[targetLevel];
  if (!ladder) return null;

  const tiers = ENHANCE_MATERIAL_TIERS[item.rarity] ?? ENHANCE_MATERIAL_TIERS.common;
  const [tierIndex, quantity] = ladder;
  return { rarity: tiers[tierIndex], quantity };
}

/**
 * 從背包扣掉一次強化要付的材料，回傳實際扣了哪一種。
 *
 * 同稀有度有 6 種材料（3 種魚 + 3 種礦），一律挑「庫存最多的那一種」：玩家不用多按一次選單
 * （一趟 +10 平均要按 76 次強化，多一步就是多 76 次點擊），而且挑最多的天然會避開快用完的稀缺材料。
 * 扣減本身是 conditional update，跟賣出/購買同一套競態防護。
 */
// 「會被扣掉的那一種材料」的唯一查詢來源：顯示用（按鈕標籤）跟實際扣除都走這裡，
// 免得兩邊的排序或型別過濾哪天走鐘，變成按鈕寫 A、實際扣 B
function findEnhanceMaterials(
  client: Prisma.TransactionClient,
  userInternalId: string,
  rarity: string,
  minQuantity: number
) {
  return client.inventory.findMany({
    where: {
      userId: userInternalId,
      quantity: { gte: minQuantity },
      item: { rarity, type: { in: [...ENHANCE_MATERIAL_TYPES] } },
    },
    include: { item: true },
    orderBy: { quantity: "desc" },
  });
}

async function consumeEnhanceMaterial(
  tx: Prisma.TransactionClient,
  userInternalId: string,
  requirement: EnhanceMaterialRequirement,
  targetLevel: number
): Promise<EnhanceMaterialUsed> {
  const candidates = await findEnhanceMaterials(
    tx,
    userInternalId,
    requirement.rarity,
    requirement.quantity
  );

  const chosen = candidates[0];
  if (!chosen) {
    const rarityLabel = RARITY_LABELS[requirement.rarity] ?? requirement.rarity;
    throw new Error(
      `材料不夠，強化到 +${targetLevel} 需要 ${requirement.quantity} 個${rarityLabel}材料（魚類或礦石，藥水不算）`
    );
  }

  const consumed = await tx.inventory.updateMany({
    where: { id: chosen.id, quantity: { gte: requirement.quantity } },
    data: { quantity: { decrement: requirement.quantity } },
  });
  if (consumed.count === 0) {
    throw new Error(`「${chosen.item.name}」在強化過程中被其他操作用掉了，請重新查詢後再試`);
  }

  // 扣完剛好歸零就刪掉，不留 quantity=0 的殘影（跟賣出的處理一致）
  await tx.inventory.deleteMany({ where: { id: chosen.id, quantity: { lte: 0 } } });

  return {
    name: chosen.item.name,
    quantity: requirement.quantity,
    remaining: chosen.quantity - requirement.quantity,
  };
}

/** 這次強化實際被消耗掉的材料；+5 以下不收材料時是 null */
export interface EnhanceMaterialUsed {
  name: string;
  quantity: number;
  /** 扣完之後還剩幾個 */
  remaining: number;
}

export interface EnhanceResult {
  item: Item;
  success: boolean;
  /** 強化前的等級 */
  previousLevel: number;
  /** 強化後的等級（成功 +1、失敗可能 -1 或不變） */
  newLevel: number;
  cost: number;
  goldAfter: number;
  /** 這次是不是失敗且掉了一級 */
  droppedLevel: boolean;
  /** 消耗掉的材料，失敗一樣會扣（跟金幣同一套規則） */
  materialUsed: EnhanceMaterialUsed | null;
}

/** 一件裝備實體：玩家擁有的「這一件」武器/防具/飾品 */
export interface EquipmentInstance {
  instanceId: string;
  item: Item;
  enhanceLevel: number;
  /** 目前裝在哪一欄；沒裝的話是 null */
  equippedSlot: EquipSlot | null;
}

// 背包同時有兩種東西：可堆疊的消耗品/材料（一列帶數量），跟一件一列的裝備實體。
// 統一成同一個聯集型別，呼叫端用 kind 分辨，排序/分頁/顯示都能一起處理
export type InventoryEntry =
  | { kind: "stack"; item: Item; quantity: number }
  | ({ kind: "instance" } & EquipmentInstance);

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

  // 背包同時要顯示兩種東西：可堆疊的消耗品/材料，跟一件一列的裝備實體。
  // 排序照 TYPE_ORDER（裝備優先）不是字母順序；Prisma 的 orderBy 沒辦法表示自訂順序，
  // 用 JS 排序，資料量小（一個玩家的背包）效能不是問題。
  // 同名裝備照強化等級由高到低排，讓練起來的那件排在前面、不容易誤選到 +0 的
  static async getInventory(userInternalId: string): Promise<InventoryEntry[]> {
    const [stacks, instances] = await Promise.all([
      prisma.inventory.findMany({ where: { userId: userInternalId }, include: { item: true } }),
      prisma.itemInstance.findMany({
        where: { userId: userInternalId },
        include: { item: true, equipped: true },
      }),
    ]);

    const entries: InventoryEntry[] = [
      ...instances.map((row) => ({
        kind: "instance" as const,
        item: row.item,
        instanceId: row.id,
        enhanceLevel: row.enhanceLevel,
        equippedSlot: (row.equipped?.slot ?? null) as EquipSlot | null,
      })),
      ...stacks.map((row) => ({ kind: "stack" as const, item: row.item, quantity: row.quantity })),
    ];

    return entries.sort((a, b) => {
      const byType = TYPE_ORDER.indexOf(a.item.type) - TYPE_ORDER.indexOf(b.item.type);
      if (byType !== 0) return byType;
      const byName = a.item.name.localeCompare(b.item.name);
      if (byName !== 0) return byName;
      const aLevel = a.kind === "instance" ? a.enhanceLevel : 0;
      const bLevel = b.kind === "instance" ? b.enhanceLevel : 0;
      return bLevel - aLevel;
    });
  }

  static async getEquipped(userInternalId: string) {
    const rows = await prisma.equippedItem.findMany({
      where: { userId: userInternalId },
      include: { instance: { include: { item: true } } },
    });
    const bySlot = new Map(rows.map((row) => [row.slot, row]));
    return EQUIP_SLOTS.map((slot) => {
      const row = bySlot.get(slot);
      return {
        slot,
        equipped: row
          ? {
              instanceId: row.itemInstanceId,
              enhanceLevel: row.instance.enhanceLevel,
              item: row.instance.item,
            }
          : null,
      };
    });
  }

  /** 每種道具各擁有幾個：可堆疊的算數量，裝備則是實體件數（含裝在身上的） */
  static async getOwnedCountsByName(userInternalId: string): Promise<Map<string, number>> {
    const entries = await this.getInventory(userInternalId);
    const counts = new Map<string, number>();
    for (const entry of entries) {
      const amount = entry.kind === "stack" ? entry.quantity : 1;
      counts.set(entry.item.name, (counts.get(entry.item.name) ?? 0) + amount);
    }
    return counts;
  }

  /** 這件裝備實體算上強化之後的實際效果值（第一/第二效果都套同一個倍率） */
  static describeInstanceEffects(item: Item, enhanceLevel: number): { type: string; value: number }[] {
    const effects = [{ type: item.effectType, value: enhancedValue(item.effectValue, enhanceLevel) }];
    if (item.effectType2 && item.effectValue2 != null) {
      effects.push({ type: item.effectType2, value: enhancedValue(item.effectValue2, enhanceLevel) });
    }
    return effects;
  }

  // 跟目前裝備比較數值差異，給商店/鍛造/背包清單共用：武器/防具只有一個對應欄位，直接比；
  // 飾品有三欄，同屬性的話跟其中最弱的比，沒有同屬性的裝備就不比、只顯示這件道具本身的數值
  static computeEquipComparison(
    itemType: string,
    item: { effectType: string; effectType2?: string | null; effectValue: number; effectValue2?: number | null },
    equipped: Awaited<ReturnType<typeof ItemService.getEquipped>>,
    candidateEnhanceLevel = 0
  ): string {
    // 候選裝備自己也可能已經強化過（背包裡的 +7），數值要先套上倍率再拿去比
    const candidateEffects: { type: string; value: number }[] = [
      { type: item.effectType, value: enhancedValue(item.effectValue, candidateEnhanceLevel) },
    ];
    if (item.effectType2 && item.effectValue2 != null) {
      candidateEffects.push({
        type: item.effectType2,
        value: enhancedValue(item.effectValue2, candidateEnhanceLevel),
      });
    }

    const referenceSlots: string[] =
      itemType === "weapon" ? ["weapon"] : itemType === "armor" ? ["armor"] : itemType === "accessory" ? [...ACCESSORY_SLOTS] : [];

    // 拿來比較的是「目前裝備算上強化之後」的實際數值，不然 +7 的裝備會被當成 +0 來比
    const referenceEffects: { type: string; value: number }[] = [];
    for (const slot of referenceSlots) {
      const eq = equipped.find((e) => e.slot === slot)?.equipped;
      if (!eq) continue;
      referenceEffects.push(...this.describeInstanceEffects(eq.item, eq.enhanceLevel));
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
      include: { instance: { include: { item: true } } },
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

    // 效果值都要先套上這件實體的強化倍率；神話級鍛造裝備的第二效果也一樣算
    for (const row of rows) {
      for (const effect of this.describeInstanceEffects(row.instance.item, row.instance.enhanceLevel)) {
        applyEffect(effect.type, effect.value);
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
    const ownedQuantity = await prisma.$transaction(async (tx) => {
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

      // 裝備一件一列（各自能有不同強化等級），消耗品/材料才走可堆疊的 Inventory
      if (EQUIPPABLE_TYPES.includes(item.type)) {
        await tx.itemInstance.createMany({
          data: Array.from({ length: amount }, () => ({ userId: userInternalId, itemId: item.id })),
        });
        return tx.itemInstance.count({ where: { userId: userInternalId, itemId: item.id } });
      }

      const stack = await tx.inventory.upsert({
        where: { userId_itemId: { userId: userInternalId, itemId: item.id } },
        create: { userId: userInternalId, itemId: item.id, quantity: amount },
        update: { quantity: { increment: amount } },
      });
      return stack.quantity;
    });

    const autoEquipped = await this.maybeAutoEquip(userInternalId, item);
    return { item, quantity: ownedQuantity, boughtAmount: amount, totalCost, autoEquippedSlot: autoEquipped?.slot ?? null };
  }

  /** 找一件目前沒裝在身上的實體；同名多件時挑強化等級最低的（練起來的那件留著） */
  private static async findUnequippedInstance(userInternalId: string, itemId: string) {
    return prisma.itemInstance.findFirst({
      where: { userId: userInternalId, itemId, equipped: { is: null } },
      orderBy: { enhanceLevel: "asc" },
      include: { item: true },
    });
  }

  // 買到/鍛造出裝備時自動判斷要不要裝上：
  // - 武器/防具：該欄位是空的就直接裝；有東西的話只有比現在強才換上（比的是算過強化的實際數值）
  // - 飾品：兩個效果類型不一定能比大小，只有還有空欄位時才自動裝，三格都滿了就不自動處理
  private static async maybeAutoEquip(
    userInternalId: string,
    item: Item
  ): Promise<{ slot: EquipSlot } | null> {
    if (!EQUIPPABLE_TYPES.includes(item.type)) return null;

    const instance = await this.findUnequippedInstance(userInternalId, item.id);
    if (!instance) return null;

    if (item.type === "weapon" || item.type === "armor") {
      const slot: EquipSlot = item.type === "weapon" ? "weapon" : "armor";
      const current = await prisma.equippedItem.findUnique({
        where: { userId_slot: { userId: userInternalId, slot } },
        include: { instance: { include: { item: true } } },
      });

      const currentValue = current
        ? enhancedValue(current.instance.item.effectValue, current.instance.enhanceLevel)
        : -1;
      const candidateValue = enhancedValue(item.effectValue, instance.enhanceLevel);
      if (candidateValue <= currentValue) return null;

      const result = await this.equipItem(userInternalId, instance.id);
      return { slot: result.slot };
    }

    const equippedRows = await prisma.equippedItem.findMany({ where: { userId: userInternalId } });
    const occupiedSlots = new Set(equippedRows.map((row) => row.slot));
    const hasEmptySlot = ACCESSORY_SLOTS.some((slot) => !occupiedSlots.has(slot));
    if (!hasEmptySlot) return null;

    const result = await this.equipItem(userInternalId, instance.id);
    return { slot: result.slot };
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
      const isEquipment = EQUIPPABLE_TYPES.includes(item.type);
      throw new Error(
        isEquipment
          ? `「${item.name}」目前全部都在裝備中，沒有可以賣的`
          : `你沒有「${item.name}」可以賣`
      );
    }

    return this.sellItemQuantity(userInternalId, item, sellableQuantity);
  }

  // public：inventory.ts 要在「賣出」按鈕上直接標出可賣數量/總價（裝備中的不算），不用等按下去才知道
  static async getSellableQuantity(userInternalId: string, itemId: string): Promise<number> {
    const item = await prisma.item.findUnique({ where: { id: itemId } });
    if (!item) return 0;

    // 裝備：算沒有裝在身上的實體有幾件（裝在身上的那件本來就不該被賣掉）
    if (EQUIPPABLE_TYPES.includes(item.type)) {
      return prisma.itemInstance.count({
        where: { userId: userInternalId, itemId, equipped: { is: null } },
      });
    }

    const inventory = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId: userInternalId, itemId } },
    });
    return inventory?.quantity ?? 0;
  }

  private static async sellItemQuantity(userInternalId: string, item: Item, amount: number) {
    if (EQUIPPABLE_TYPES.includes(item.type)) {
      return this.sellEquipmentInstances(userInternalId, item, amount);
    }

    const inventory = await prisma.inventory.findUnique({
      where: { userId_itemId: { userId: userInternalId, itemId: item.id } },
    });
    if (!inventory || inventory.quantity <= 0) {
      throw new Error(`你沒有「${item.name}」可以賣`);
    }

    if (amount > inventory.quantity) {
      throw new Error(`「${item.name}」最多只能賣 ${inventory.quantity} 個`);
    }

    const sellPrice = this.getSellPricePerUnit(item) * amount;

    // 賣出的扣減包成 conditional update，不會有「查完數量、真的扣之前庫存已經被別的操作動過」
    // 的競態（例如兩個賣出請求同時打進來）
    const [updatedUser] = await prisma.$transaction(async (tx) => {
      const claimed = await tx.inventory.updateMany({
        where: { id: inventory.id, quantity: { gte: amount } },
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

  // 賣裝備：一件一列，所以是「刪掉 N 個沒裝在身上的實體」。
  // 刻意從強化等級最低的開始賣，玩家練起來的那件不會因為誤觸就消失；
  // 售價也照各自的強化等級加成，賣掉 +7 的不會跟 +0 同價
  private static async sellEquipmentInstances(userInternalId: string, item: Item, amount: number) {
    const sellable = await prisma.itemInstance.findMany({
      where: { userId: userInternalId, itemId: item.id, equipped: { is: null } },
      orderBy: [{ enhanceLevel: "asc" }, { createdAt: "asc" }],
      take: amount,
    });

    if (sellable.length === 0) {
      const owned = await prisma.itemInstance.count({ where: { userId: userInternalId, itemId: item.id } });
      throw new Error(
        owned > 0
          ? `「${item.name}」目前正在裝備中，無法賣掉，請先換裝再賣`
          : `你沒有「${item.name}」可以賣`
      );
    }
    if (sellable.length < amount) {
      throw new Error(`「${item.name}」最多只能賣 ${sellable.length} 個（裝備中的不能賣）`);
    }

    const unitPrice = this.getSellPricePerUnit(item);
    const sellPrice = sellable.reduce(
      (sum, inst) => sum + enhancedValue(unitPrice, inst.enhanceLevel),
      0
    );
    const ids = sellable.map((inst) => inst.id);

    const [updatedUser] = await prisma.$transaction(async (tx) => {
      // 條件帶上「還沒被裝備」，避免查完到真的刪之間有人把它裝上去
      const deleted = await tx.itemInstance.deleteMany({
        where: { id: { in: ids }, userId: userInternalId, equipped: { is: null } },
      });
      if (deleted.count !== ids.length) {
        throw new Error(`「${item.name}」的狀態在賣出前被其他操作改變了，請重新查詢後再試`);
      }

      const user = await tx.user.update({
        where: { id: userInternalId },
        data: { gold: { increment: sellPrice } },
      });
      return [user];
    });

    return { item, sellPrice, amount: sellable.length, goldAfter: updatedUser.gold };
  }

  /**
   * 賣掉指定的那一件裝備實體。裝備有了實體之後，背包裡選中的就是明確的某一件
   * （+7 的跟 +0 的是兩筆），所以不需要像可堆疊道具那樣再選數量
   */
  static async sellInstance(userInternalId: string, instanceId: string) {
    const instance = await prisma.itemInstance.findUnique({
      where: { id: instanceId },
      include: { item: true, equipped: true },
    });
    if (!instance || instance.userId !== userInternalId) {
      throw new Error("找不到這件裝備，可能已經被賣掉了");
    }
    if (instance.equipped) {
      throw new Error(`「${instance.item.name}」正在裝備中，請先換裝再賣`);
    }

    const sellPrice = enhancedValue(this.getSellPricePerUnit(instance.item), instance.enhanceLevel);

    const [updatedUser] = await prisma.$transaction(async (tx) => {
      const deleted = await tx.itemInstance.deleteMany({
        where: { id: instanceId, userId: userInternalId, equipped: { is: null } },
      });
      if (deleted.count === 0) {
        throw new Error(`「${instance.item.name}」的狀態在賣出前被其他操作改變了，請重新查詢後再試`);
      }
      const user = await tx.user.update({
        where: { id: userInternalId },
        data: { gold: { increment: sellPrice } },
      });
      return [user];
    });

    return {
      item: instance.item,
      enhanceLevel: instance.enhanceLevel,
      sellPrice,
      goldAfter: updatedUser.gold,
    };
  }

  /**
   * 強化按鈕要顯示的材料狀態：這一級要付幾個什麼階級的材料、實際會扣掉哪一種、手上有幾個。
   * +5 以下不收材料，回傳 null。
   *
   * 一種都沒有時 name 是 null，呼叫端改用稀有度通稱顯示（「史詩材料 0/1」）。
   * owned 是「庫存最多的那一種」的數量而不是全部同階材料的總和——因為一次強化只吃同一種，
   * 手上各有 1 個藍水晶跟 1 個金礦並不能湊成 +8 要的 2 個
   */
  static async getEnhanceMaterialStatus(
    userInternalId: string,
    item: Item,
    targetLevel: number
  ): Promise<{
    requirement: EnhanceMaterialRequirement;
    name: string | null;
    owned: number;
  } | null> {
    const requirement = enhanceMaterialRequirement(item, targetLevel);
    if (!requirement) return null;

    const candidates = await findEnhanceMaterials(prisma, userInternalId, requirement.rarity, 1);
    const chosen = candidates[0];
    return { requirement, name: chosen?.item.name ?? null, owned: chosen?.quantity ?? 0 };
  }

  /**
   * 強化指定的那一件裝備。成功 +1 級；失敗只損失費用，+6 以上失敗還會退一級。
   * 金幣的扣款用 conditional update（跟買東西一樣的手法），避免「查完錢夠、扣款前錢被花掉」的競態；
   * 等級的更新也帶上「等級還是強化前那個值」的條件，兩邊同時按強化不會把等級推成 +2
   */
  static async enhanceInstance(userInternalId: string, instanceId: string): Promise<EnhanceResult> {
    const instance = await prisma.itemInstance.findUnique({
      where: { id: instanceId },
      include: { item: true },
    });
    if (!instance || instance.userId !== userInternalId) {
      throw new Error("找不到這件裝備，可能已經被賣掉了");
    }

    const previousLevel = instance.enhanceLevel;
    const targetLevel = previousLevel + 1;
    if (targetLevel > MAX_ENHANCE_LEVEL) {
      throw new Error(`「${instance.item.name}」已經是 +${MAX_ENHANCE_LEVEL}，沒辦法再強化了`);
    }

    const cost = enhanceCost(instance.item);
    const requirement = enhanceMaterialRequirement(instance.item, targetLevel);

    const result = await prisma.$transaction(async (tx) => {
      // 材料先扣再扣金幣：後期玩家金幣充裕、卡住的幾乎都是材料，先擋掉可以少做一次「扣款又回滾」
      const materialUsed = requirement
        ? await consumeEnhanceMaterial(tx, userInternalId, requirement, targetLevel)
        : null;

      const paid = await tx.user.updateMany({
        where: { id: userInternalId, gold: { gte: cost } },
        data: { gold: { decrement: cost } },
      });
      if (paid.count === 0) {
        const user = await tx.user.findUniqueOrThrow({ where: { id: userInternalId } });
        throw new Error(`金幣不夠，強化一次要 ${cost} 金幣，你只有 ${user.gold} 金幣`);
      }

      const success = randomChance(enhanceSuccessRate(targetLevel));
      const droppedLevel = !success && enhanceFailureDropsLevel(targetLevel);
      const newLevel = success ? targetLevel : droppedLevel ? previousLevel - 1 : previousLevel;

      if (newLevel !== previousLevel) {
        const updated = await tx.itemInstance.updateMany({
          where: { id: instanceId, enhanceLevel: previousLevel },
          data: { enhanceLevel: newLevel },
        });
        if (updated.count === 0) {
          throw new Error("這件裝備的狀態在強化過程中被改變了，請重新查詢後再試");
        }
      }

      const user = await tx.user.findUniqueOrThrow({ where: { id: userInternalId } });
      return { success, newLevel, droppedLevel, goldAfter: user.gold, materialUsed };
    });

    return { item: instance.item, previousLevel, cost, ...result };
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

  // 裝上「這一件」實體。preferredSlot 給飾品指定要換掉哪一欄；不指定時維持「優先塞空格、
  // 三格都滿了預設頂掉 accessory1」的自動邏輯（武器/防具本來就只有一個對應欄位）。
  //
  // 改成實體之後，原本「手上數量夠不夠再裝到另一欄」的檢查整個不需要了——
  // 一件實體本來就只能出現在一個欄位，靠 EquippedItem.itemInstanceId 的 unique 保證
  static async equipItem(userInternalId: string, instanceId: string, preferredSlot?: EquipSlot) {
    const instance = await prisma.itemInstance.findUnique({
      where: { id: instanceId },
      include: { item: true },
    });
    if (!instance || instance.userId !== userInternalId) {
      throw new Error("找不到這件裝備，可能已經被賣掉了");
    }
    const item = instance.item;
    if (!EQUIPPABLE_TYPES.includes(item.type)) {
      throw new Error(`「${item.name}」不是可以裝備的道具`);
    }

    const equippedRows = await prisma.equippedItem.findMany({
      where: { userId: userInternalId },
      include: { instance: { include: { item: true } } },
    });

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
    const replacedItem =
      currentInTargetSlot && currentInTargetSlot.itemInstanceId !== instanceId
        ? currentInTargetSlot.instance.item
        : null;

    await prisma.$transaction(async (tx) => {
      // 這件實體如果本來裝在別的欄位，要先拆下來，不然 itemInstanceId 的 unique 會撞
      await tx.equippedItem.deleteMany({ where: { itemInstanceId: instanceId } });
      await tx.equippedItem.upsert({
        where: { userId_slot: { userId: userInternalId, slot: targetSlot } },
        create: { userId: userInternalId, itemInstanceId: instanceId, slot: targetSlot },
        update: { itemInstanceId: instanceId },
      });
    });

    return { item, instanceId, slot: targetSlot, replacedItem };
  }

  /** 依名稱裝備：挑一件沒裝在身上的同名實體裝上（自動裝備、測試等不在意是哪一件的場合用） */
  static async equipItemByName(userInternalId: string, itemName: string, preferredSlot?: EquipSlot) {
    const item = await this.findItemByName(itemName);
    if (!item) throw new Error(`「${itemName}」不是有效的道具名稱`);
    if (!EQUIPPABLE_TYPES.includes(item.type)) {
      throw new Error(`「${item.name}」不是可以裝備的道具`);
    }

    // 優先挑沒裝在身上的；全部都裝著的話就拿其中一件——把已經裝備的飾品換到另一欄是合法操作，
    // 不該因為「沒有閒置的同名裝備」就被擋下來
    const instance =
      (await this.findUnequippedInstance(userInternalId, item.id)) ??
      (await prisma.itemInstance.findFirst({
        where: { userId: userInternalId, itemId: item.id },
        orderBy: { enhanceLevel: "desc" },
      }));
    if (!instance) throw new Error(`你沒有可以裝備的「${item.name}」`);

    return this.equipItem(userInternalId, instance.id, preferredSlot);
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

      // 鍛造出來的裝備是一件新的實體（強化等級 0）；非裝備才走可堆疊的 Inventory
      if (EQUIPPABLE_TYPES.includes(item.type)) {
        await tx.itemInstance.create({ data: { userId: userInternalId, itemId: item.id } });
      } else {
        await tx.inventory.upsert({
          where: { userId_itemId: { userId: userInternalId, itemId: item.id } },
          create: { userId: userInternalId, itemId: item.id, quantity: 1 },
          update: { quantity: { increment: 1 } },
        });
      }
    });

    const quantity = EQUIPPABLE_TYPES.includes(item.type)
      ? await prisma.itemInstance.count({ where: { userId: userInternalId, itemId: item.id } })
      : (
          await prisma.inventory.findUnique({
            where: { userId_itemId: { userId: userInternalId, itemId: item.id } },
          })
        )?.quantity ?? 1;

    const autoEquipped = await this.maybeAutoEquip(userInternalId, item);
    return { item, quantity, autoEquippedSlot: autoEquipped?.slot ?? null };
  }
}
