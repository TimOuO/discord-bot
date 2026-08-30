import prisma from "../services/dbService";

// /rpg fish 用的魚類道具，用 upsert 寫入，重複執行也安全（部署時每次都會跑一次）
const FISH_ITEMS = [
  {
    name: "小魚乾",
    description: "隨處可見的小魚，曬乾了也還是很多人搶著要。",
    rarity: "common",
    cost: 10,
  },
  {
    name: "虹鱒",
    description: "體色帶點彩虹光澤的溪魚。",
    rarity: "uncommon",
    cost: 30,
  },
  {
    name: "銀鱗鮭",
    description: "鱗片閃著銀光，肉質鮮美。",
    rarity: "rare",
    cost: 80,
  },
  {
    name: "深海鮟鱇魚",
    description: "長相嚇人但意外美味的深海魚類。",
    rarity: "epic",
    cost: 200,
  },
  {
    name: "黃金鯉魚",
    description: "傳說中會帶來好運的金色鯉魚，極其罕見。",
    rarity: "legendary",
    cost: 600,
  },
];

async function seedFishItems() {
  try {
    for (const fish of FISH_ITEMS) {
      await prisma.item.upsert({
        where: { name: fish.name },
        create: {
          name: fish.name,
          description: fish.description,
          type: "fish",
          rarity: fish.rarity,
          cost: fish.cost,
          effectType: "none",
          effectValue: 0,
        },
        update: {},
      });
    }
    console.log(`魚類道具種子完成（共 ${FISH_ITEMS.length} 種）`);
  } catch (error) {
    console.error("魚類道具種子失敗:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

seedFishItems();
