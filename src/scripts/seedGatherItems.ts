import prisma from "../services/dbService";

// /rpg gather 用的採集材料，用 upsert 寫入，重複執行也安全（部署時每次都會跑一次）
// 同一個稀有度放多種材料，跟 rpgService.ts 的 GATHER_TABLE 對應（抽中稀有度後隨機選一種）
const GATHER_ITEMS = [
  { name: "樹枝", description: "隨處可見的枯枝，生火或做工具都能用。", rarity: "common", cost: 10 },
  { name: "石頭", description: "普通的石頭，堆哪都不奇怪。", rarity: "common", cost: 10 },
  { name: "麻繩", description: "自己搓的麻繩，粗糙但堪用。", rarity: "common", cost: 10 },

  { name: "鐵礦", description: "帶著鏽紅色澤的鐵礦石。", rarity: "uncommon", cost: 30 },
  { name: "煤炭", description: "燒起來很旺的黑色礦石。", rarity: "uncommon", cost: 30 },
  { name: "硬木", description: "質地堅硬的木材，適合做家具。", rarity: "uncommon", cost: 30 },

  { name: "銀礦", description: "泛著銀白色光澤的礦石。", rarity: "rare", cost: 80 },
  { name: "玉石", description: "溫潤有光澤的玉石，價值不斐。", rarity: "rare", cost: 80 },
  { name: "陳年木材", description: "存放多年、質地緊密的木材。", rarity: "rare", cost: 80 },

  { name: "金礦", description: "閃閃發光的金礦石，人人都想要。", rarity: "epic", cost: 200 },
  { name: "藍水晶", description: "散發淡藍色光芒的稀有水晶。", rarity: "epic", cost: 200 },
  { name: "魔力碎片", description: "帶著微弱魔力波動的神秘碎片。", rarity: "epic", cost: 200 },

  { name: "紫水晶", description: "散發神秘紫色光芒的稀有水晶。", rarity: "legendary", cost: 600 },
  { name: "星隕石", description: "從天而降的隕石碎片，蘊藏強大能量。", rarity: "legendary", cost: 600 },
  { name: "遠古符文石", description: "刻著失傳符文的古老石塊，傳說中的存在。", rarity: "legendary", cost: 600 },
];

async function seedGatherItems() {
  try {
    for (const material of GATHER_ITEMS) {
      await prisma.item.upsert({
        where: { name: material.name },
        create: {
          name: material.name,
          description: material.description,
          type: "material",
          rarity: material.rarity,
          cost: material.cost,
          effectType: "none",
          effectValue: 0,
        },
        update: {},
      });
    }
    console.log(`採集材料種子完成（共 ${GATHER_ITEMS.length} 種）`);
  } catch (error) {
    console.error("採集材料種子失敗:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

seedGatherItems();
