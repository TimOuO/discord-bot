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
