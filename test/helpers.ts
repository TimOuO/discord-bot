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
