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
  // 藥水原本只到 rare（+150），現在玩家生命上限普遍已經數百，回滿要吃好幾瓶，補上 epic/legendary
  {
    name: "極品生命藥水",
    description: "鍊金術士傾盡心血調配的藥水，回復效果驚人。",
    type: "potion",
    rarity: "epic",
    cost: 500,
    effectType: "heal",
    effectValue: 300,
  },
  {
    name: "聖光藥水",
    description: "教會秘傳的聖光聖水，飲下後傷勢瞬間痊癒。",
    type: "potion",
    rarity: "legendary",
    cost: 1200,
    effectType: "heal",
    effectValue: 600,
  },
  // 爆擊率/閃避率/金幣加成/經驗加成原本只有神話裝備才有，商店補上比較親民的版本，
  // 讓玩家不用先鍛造神話裝備就能體驗這些新機制
  {
    name: "幸運兔腳",
    description: "據說能帶來財運的兔腳吊飾。",
    type: "accessory",
    rarity: "rare",
    cost: 400,
    effectType: "goldBonus",
    effectValue: 5,
  },
  {
    name: "貓步之靴",
    description: "穿上後腳步輕盈如貓，躲避攻擊更加靈活。",
    type: "accessory",
    rarity: "rare",
    cost: 400,
    effectType: "dodgeRate",
    effectValue: 4,
  },
  {
    name: "智慧護符",
    description: "刻著古老智慧符文的護符，加快學習與成長的速度。",
    type: "accessory",
    rarity: "epic",
    cost: 900,
    effectType: "xpBonus",
    effectValue: 10,
  },
  {
    name: "嗜血之戒",
    description: "戴上後隱約能感受到嗜血的衝動，出手更容易一擊致命。",
    type: "accessory",
    rarity: "epic",
    cost: 900,
    effectType: "critRate",
    effectValue: 8,
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
