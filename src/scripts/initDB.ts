import prisma from "../services/dbService";

/**
 * 初始化基本物品到資料庫
 */
async function initDB() {
  try {
    // 檢查資料庫中是否已經有物品
    const itemCount = await prisma.item.count();

    if (itemCount > 0) {
      console.log("資料庫中已有物品，跳過初始化");
      return;
    }

    console.log("開始初始化資料庫基本物品...");

    // 基本武器（加攻擊力）
    await prisma.item.createMany({
      data: [
        {
          name: "木劍",
          description: "基本的木製劍，適合初學者使用。",
          type: "weapon",
          rarity: "common",
          cost: 50,
          effectType: "attack",
          effectValue: 5,
        },
        {
          name: "鐵劍",
          description: "堅固的鐵製劍，提供更強的攻擊力。",
          type: "weapon",
          rarity: "uncommon",
          cost: 150,
          effectType: "attack",
          effectValue: 12,
        },
        {
          name: "精鋼劍",
          description: "由優質鋼鐵鍛造的劍，鋒利無比。",
          type: "weapon",
          rarity: "rare",
          cost: 500,
          effectType: "attack",
          effectValue: 25,
        },
      ],
    });

    // 基本防具（加防禦力）
    await prisma.item.createMany({
      data: [
        {
          name: "皮革護甲",
          description: "提供基本防護的輕便護甲。",
          type: "armor",
          rarity: "common",
          cost: 40,
          effectType: "defense",
          effectValue: 3,
        },
        {
          name: "鎖子甲",
          description: "金屬環連接的護甲，提供中等防護。",
          type: "armor",
          rarity: "uncommon",
          cost: 180,
          effectType: "defense",
          effectValue: 8,
        },
        {
          name: "板甲",
          description: "堅固的金屬板護甲，提供強大的防護。",
          type: "armor",
          rarity: "rare",
          cost: 450,
          effectType: "defense",
          effectValue: 18,
        },
      ],
    });

    // 飾品（每件加成的屬性不同）
    await prisma.item.createMany({
      data: [
        {
          name: "力量護符",
          description: "蘊含微弱力量的護符，提升攻擊力。",
          type: "accessory",
          rarity: "common",
          cost: 60,
          effectType: "attack",
          effectValue: 4,
        },
        {
          name: "守護指環",
          description: "刻有守護符文的指環，提升防禦力。",
          type: "accessory",
          rarity: "uncommon",
          cost: 200,
          effectType: "defense",
          effectValue: 6,
        },
        {
          name: "生命寶石",
          description: "蘊藏生命能量的寶石，提升生命上限。",
          type: "accessory",
          rarity: "rare",
          cost: 400,
          effectType: "maxHealth",
          effectValue: 30,
        },
      ],
    });

    // 基本藥水（恢復生命值）
    await prisma.item.createMany({
      data: [
        {
          name: "小型生命藥水",
          description: "恢復少量生命值。",
          type: "potion",
          rarity: "common",
          cost: 25,
          effectType: "heal",
          effectValue: 30,
        },
        {
          name: "中型生命藥水",
          description: "恢復中等生命值。",
          type: "potion",
          rarity: "uncommon",
          cost: 75,
          effectType: "heal",
          effectValue: 75,
        },
        {
          name: "大型生命藥水",
          description: "恢復大量生命值。",
          type: "potion",
          rarity: "rare",
          cost: 200,
          effectType: "heal",
          effectValue: 150,
        },
      ],
    });

    console.log("資料庫初始化完成！");
  } catch (error) {
    console.error("資料庫初始化失敗:", error);
  } finally {
    await prisma.$disconnect();
  }
}

// 執行初始化
initDB();
