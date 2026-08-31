import prisma from "../services/dbService";

// 商店原本最高只到 rare，高等級玩家沒有裝備可以換，這裡補上 epic / legendary 兩層
// 用 upsert 寫入，重複執行也安全（部署時每次都會跑一次）
const HIGH_TIER_ITEMS = [
  {
    name: "秘銀劍",
    description: "秘銀鍛造的劍身，輕盈卻無比銳利。",
    type: "weapon",
    rarity: "epic",
    cost: 1200,
    effectType: "attack",
    effectValue: 45,
  },
  {
    name: "屠龍劍",
    description: "傳說中屠殺過巨龍的劍，劍身刻著古老的紋路。",
    type: "weapon",
    rarity: "legendary",
    cost: 3000,
    effectType: "attack",
    effectValue: 80,
  },
  {
    name: "秘銀鎧甲",
    description: "以秘銀打造的鎧甲，防禦力驚人卻不失靈活。",
    type: "armor",
    rarity: "epic",
    cost: 1100,
    effectType: "defense",
    effectValue: 32,
  },
  {
    name: "龍鱗甲",
    description: "以龍鱗編織而成的護甲，幾乎刀槍不入。",
    type: "armor",
    rarity: "legendary",
    cost: 2800,
    effectType: "defense",
    effectValue: 58,
  },
  {
    name: "巨力護腕",
    description: "蘊藏巨大力量的護腕，戴上後力大無窮。",
    type: "accessory",
    rarity: "epic",
    cost: 900,
    effectType: "attack",
    effectValue: 18,
  },
  {
    name: "不死鳥之心",
    description: "傳說中不死鳥的心臟結晶，賦予強大的生命力。",
    type: "accessory",
    rarity: "legendary",
    cost: 2500,
    effectType: "maxHealth",
    effectValue: 100,
  },
];

async function seedHighTierItems() {
  try {
    for (const item of HIGH_TIER_ITEMS) {
      await prisma.item.upsert({
        where: { name: item.name },
        create: item,
        update: {},
      });
    }
    console.log(`高階裝備種子完成（共 ${HIGH_TIER_ITEMS.length} 件）`);
  } catch (error) {
    console.error("高階裝備種子失敗:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

seedHighTierItems();
