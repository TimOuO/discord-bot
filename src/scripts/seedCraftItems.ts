import prisma from "../services/dbService";

// /rpg craft 用的神話級鍛造裝備，purchasable: false（商店買不到，只能鍛造），
// 用 upsert 寫入，重複執行也安全（部署時每次都會跑一次）
// 數值刻意壓過 seedHighTierItems.ts 的傳說裝備（attack 80 / defense 58 / maxHealth 100），
// 讓神話裝備真的值得花材料去鍛造
//
// 主題式雙屬性搭配：
//   武器＝攻擊力 + 爆擊率（2 件，數值互有取捨）
//   防具＝防禦力 + 閃避率（2 件，數值互有取捨）
//   飾品＝生命上限／金幣加成／經驗加成 3 選 2（3 件，每件代表一種組合）
const CRAFT_ITEMS = [
  {
    name: "神話之刃",
    description: "以稀有礦石與深海魚骨鍛造而成的神兵，劍身輕巧、出手如電。",
    type: "weapon",
    rarity: "mythic",
    cost: 6500,
    effectType: "attack",
    effectValue: 120,
    effectType2: "critRate",
    effectValue2: 18,
    recipe: [
      { itemName: "銀礦", quantity: 5 },
      { itemName: "深海鮟鱇魚", quantity: 3 },
      { itemName: "紫水晶", quantity: 1 },
    ],
  },
  {
    name: "混沌戰斧",
    description: "融合龍虎斑鱗片與魚王精華的巨斧，招招都是壓倒性的重擊。",
    type: "weapon",
    rarity: "mythic",
    cost: 7000,
    effectType: "attack",
    effectValue: 130,
    effectType2: "critRate",
    effectValue2: 8,
    recipe: [
      { itemName: "龍虎斑", quantity: 5 },
      { itemName: "金礦", quantity: 3 },
      { itemName: "神秘魚王", quantity: 1 },
    ],
  },
  {
    name: "神話聖鎧",
    description: "以玉石與電鰻精華打造的聖鎧，輕盈得讓人幾乎感覺不到重量。",
    type: "armor",
    rarity: "mythic",
    cost: 6000,
    effectType: "defense",
    effectValue: 85,
    effectType2: "dodgeRate",
    effectValue2: 12,
    recipe: [
      { itemName: "玉石", quantity: 5 },
      { itemName: "電鰻", quantity: 3 },
      { itemName: "星隕石", quantity: 1 },
    ],
  },
  {
    name: "混沌魔甲",
    description: "以紅魽與藍水晶鍛造的魔甲，厚重堅固，幾乎無懈可擊。",
    type: "armor",
    rarity: "mythic",
    cost: 6500,
    effectType: "defense",
    effectValue: 90,
    effectType2: "dodgeRate",
    effectValue2: 6,
    recipe: [
      { itemName: "紅魽", quantity: 5 },
      { itemName: "藍水晶", quantity: 3 },
      { itemName: "傳說錦鯉", quantity: 1 },
    ],
  },
  {
    name: "永恆之心",
    description: "以陳年木材與黃金鯉魚精華凝結而成的飾品，賦予永恆的生命力與財運。",
    type: "accessory",
    rarity: "mythic",
    cost: 5500,
    effectType: "maxHealth",
    effectValue: 150,
    effectType2: "goldBonus",
    effectValue2: 12,
    recipe: [
      { itemName: "陳年木材", quantity: 5 },
      { itemName: "小鯊魚", quantity: 3 },
      { itemName: "黃金鯉魚", quantity: 1 },
    ],
  },
  {
    name: "深淵之戒",
    description: "以銀鱗鮭與遠古符文石打造的戒指，蘊藏深淵的生命之力與智慧。",
    type: "accessory",
    rarity: "mythic",
    cost: 5500,
    effectType: "maxHealth",
    effectValue: 120,
    effectType2: "xpBonus",
    effectValue2: 15,
    recipe: [
      { itemName: "銀鱗鮭", quantity: 5 },
      { itemName: "魔力碎片", quantity: 3 },
      { itemName: "遠古符文石", quantity: 1 },
    ],
  },
  {
    name: "貪婪之眼",
    description: "傳說中能看穿一切財富與機運的邪眼，佩戴者總能滿載而歸。",
    type: "accessory",
    rarity: "mythic",
    cost: 6000,
    effectType: "goldBonus",
    effectValue: 18,
    effectType2: "xpBonus",
    effectValue2: 18,
    recipe: [
      { itemName: "金礦", quantity: 3 },
      { itemName: "黃金鯉魚", quantity: 3 },
      { itemName: "神秘魚王", quantity: 2 },
    ],
  },
];

async function seedCraftItems() {
  try {
    for (const item of CRAFT_ITEMS) {
      await prisma.item.upsert({
        where: { name: item.name },
        create: { ...item, purchasable: false },
        update: { ...item, purchasable: false },
      });
    }
    console.log(`鍛造裝備種子完成（共 ${CRAFT_ITEMS.length} 件）`);
  } catch (error) {
    console.error("鍛造裝備種子失敗:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

seedCraftItems();
