// 檢查資料庫內容的腳本
import prisma from "../services/dbService";

async function checkDatabase() {
  try {
    // 檢查使用者資料
    const users = await prisma.user.findMany();
    console.log(`\n===== 使用者資料 (${users.length} 筆) =====`);
    users.forEach((user) => {
      console.log(`使用者名稱: ${user.username}`);
      console.log(`Discord ID: ${user.userId}`);
      console.log(`等級: ${user.level} (XP: ${user.xp})`);
      console.log(`金幣: ${user.gold}`);
      console.log(`生命值: ${user.health}/${user.maxHealth}`);
      console.log(`攻擊力: ${user.attack}, 防禦力: ${user.defense}`);
      console.log(`上次戰鬥時間: ${user.lastBattle || "無"}`);
      console.log(`上次每日簽到: ${user.lastDaily || "無"}`);
      console.log("------------------------");
    });

    // 檢查物品資料
    const items = await prisma.item.findMany();
    console.log(`\n===== 物品資料 (${items.length} 筆) =====`);
    items.forEach((item) => {
      console.log(`名稱: ${item.name} (${item.type}, ${item.rarity})`);
      console.log(`描述: ${item.description}`);
      console.log(`價格: ${item.cost} 金幣, 效果值: ${item.effectValue}`);
      console.log("------------------------");
    });

    // 檢查庫存資料
    const inventories = await prisma.inventory.findMany({
      include: {
        user: true,
        item: true,
      },
    });
    console.log(`\n===== 庫存資料 (${inventories.length} 筆) =====`);
    inventories.forEach((inv) => {
      console.log(`使用者: ${inv.user.username}`);
      console.log(`物品: ${inv.item.name}`);
      console.log(`數量: ${inv.quantity}`);
      console.log("------------------------");
    });

    // 檢查已裝備物品資料
    const equippedItems = await prisma.equippedItem.findMany({
      include: {
        user: true,
        item: true,
      },
    });
    console.log(`\n===== 已裝備物品 (${equippedItems.length} 筆) =====`);
    equippedItems.forEach((eq) => {
      console.log(`使用者: ${eq.user.username}`);
      console.log(`物品: ${eq.item.name}`);
      console.log(`裝備欄位: ${eq.slot}`);
      console.log("------------------------");
    });
  } catch (error) {
    console.error("查詢資料庫時出錯:", error);
  } finally {
    await prisma.$disconnect();
  }
}

// 執行檢查
checkDatabase();
