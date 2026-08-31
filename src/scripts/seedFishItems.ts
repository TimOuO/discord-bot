import prisma from "../services/dbService";

// /rpg fish 用的魚類道具，用 upsert 寫入，重複執行也安全（部署時每次都會跑一次）
// 同一個稀有度放多種魚，跟 rpgService.ts 的 FISH_TABLE 對應（抽中稀有度後隨機選一種）
const FISH_ITEMS = [
  { name: "小魚乾", description: "隨處可見的小魚，曬乾了也還是很多人搶著要。", rarity: "common", cost: 10 },
  { name: "泥鰍", description: "在泥巴裡鑽來鑽去的小魚，滑溜溜的不好抓。", rarity: "common", cost: 10 },
  { name: "吳郭魚", description: "隨處可見的家魚，數量多到有點氾濫。", rarity: "common", cost: 10 },

  { name: "虹鱒", description: "體色帶點彩虹光澤的溪魚。", rarity: "uncommon", cost: 30 },
  { name: "鯖魚", description: "背部帶著波浪花紋的青背魚。", rarity: "uncommon", cost: 30 },
  { name: "花枝", description: "游動時會變色的頭足類，肉質彈牙。", rarity: "uncommon", cost: 30 },

  { name: "銀鱗鮭", description: "鱗片閃著銀光，肉質鮮美。", rarity: "rare", cost: 80 },
  { name: "龍虎斑", description: "身上有著猛獸般花紋的高級魚種。", rarity: "rare", cost: 80 },
  { name: "紅魽", description: "體色艷紅、產量稀少的高級魚。", rarity: "rare", cost: 80 },

  { name: "深海鮟鱇魚", description: "長相嚇人但意外美味的深海魚類。", rarity: "epic", cost: 200 },
  { name: "電鰻", description: "會放電的稀有魚種，釣起來要小心。", rarity: "epic", cost: 200 },
  { name: "小鯊魚", description: "誤入淡水域的小鯊魚，相當罕見。", rarity: "epic", cost: 200 },

  { name: "黃金鯉魚", description: "傳說中會帶來好運的金色鯉魚，極其罕見。", rarity: "legendary", cost: 600 },
  { name: "傳說錦鯉", description: "花紋美得不可思議的錦鯉，一輩子難得一見。", rarity: "legendary", cost: 600 },
  { name: "神秘魚王", description: "沒人見過完整長相的巨大魚影，傳說中的存在。", rarity: "legendary", cost: 600 },
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
          purchasable: false,
        },
        update: { purchasable: false },
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
