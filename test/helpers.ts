import prisma from "../src/services/dbService";
import type { Item, Prisma, User } from "../src/generated/prisma";

let counter = 0;
export function uniqueId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export async function createTestUser(
  overrides: Partial<
    Pick<
      User,
      "gold" | "level" | "attack" | "defense" | "health" | "maxHealth" | "xp"
    >
  > = {}
): Promise<{ discordUserId: string; user: User }> {
  const discordUserId = uniqueId("user");
  const user = await prisma.user.create({
    data: { userId: discordUserId, username: "測試玩家", ...overrides },
  });
  return { discordUserId, user };
}

export async function createTestItem(
  overrides: Partial<
    Pick<
      Item,
      | "name"
      | "type"
      | "rarity"
      | "cost"
      | "effectType"
      | "effectValue"
      | "description"
      | "purchasable"
    >
  > & { recipe?: Prisma.InputJsonValue } = {}
): Promise<Item> {
  return prisma.item.create({
    data: {
      name: overrides.name ?? uniqueId("item"),
      description: "測試道具",
      type: "weapon",
      rarity: "common",
      cost: 100,
      effectType: "attack",
      effectValue: 10,
      ...overrides,
    },
  });
}

/**
 * 使用者擁有幾件指定道具：可堆疊的道具算數量、裝備算實體件數（含裝在身上的）。
 * 裝備改成一件一列的實體之後，測試不需要再管它存在哪張表
 */
export async function ownedCount(userInternalId: string, itemId: string): Promise<number> {
  const [stack, instances] = await Promise.all([
    prisma.inventory.findUnique({ where: { userId_itemId: { userId: userInternalId, itemId } } }),
    prisma.itemInstance.count({ where: { userId: userInternalId, itemId } }),
  ]);
  return (stack?.quantity ?? 0) + instances;
}

// 跟 rpgService.ts 的 FISH_TABLE/GATHER_TABLE 對應（含稀有度，順序一致）。
// 放在共用 helper 而不是某個測試檔的 beforeAll：測試 DB 是整輪共用的，
// 種在單一檔案裡的話，其他測試檔能不能抽到這些道具就取決於檔案的執行順序。
export const FISH_TIERS = [
  { rarity: "common", names: ["小魚乾", "泥鰍", "吳郭魚"] },
  { rarity: "uncommon", names: ["虹鱒", "鯖魚", "花枝"] },
  { rarity: "rare", names: ["銀鱗鮭", "龍虎斑", "紅魽"] },
  { rarity: "epic", names: ["深海鮟鱇魚", "電鰻", "小鯊魚"] },
  { rarity: "legendary", names: ["黃金鯉魚", "傳說錦鯉", "神秘魚王"] },
];

export const GATHER_TIERS = [
  { rarity: "common", names: ["樹枝", "石頭", "麻繩"] },
  { rarity: "uncommon", names: ["鐵礦", "煤炭", "硬木"] },
  { rarity: "rare", names: ["銀礦", "玉石", "陳年木材"] },
  { rarity: "epic", names: ["金礦", "藍水晶", "魔力碎片"] },
  { rarity: "legendary", names: ["紫水晶", "星隕石", "遠古符文石"] },
];

export const FISH_NAMES = FISH_TIERS.flatMap((tier) => tier.names);
export const GATHER_NAMES = GATHER_TIERS.flatMap((tier) => tier.names);

/** 種好釣魚/採集會抽到的所有道具；upsert 所以重複呼叫安全，每個測試檔都可以自己叫一次 */
export async function seedHarvestItems(): Promise<void> {
  for (const [tiers, type, description] of [
    [FISH_TIERS, "fish", "測試用魚"],
    [GATHER_TIERS, "material", "測試用材料"],
  ] as const) {
    for (const { rarity, names } of tiers) {
      for (const name of names) {
        await prisma.item.upsert({
          where: { name },
          create: {
            name,
            description,
            type,
            rarity,
            cost: 10,
            effectType: "none",
            effectValue: 0,
          },
          update: {},
        });
      }
    }
  }
}
