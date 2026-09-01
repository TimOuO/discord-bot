import { describe, it, expect, beforeAll } from "vitest";
import { RPGService, xpThresholdForLevel } from "./rpgService";
import { ItemService } from "./itemService";
import { createTestUser, createTestItem } from "../../test/helpers";
import prisma from "./dbService";

// 跟 rpgService.ts 的 FISH_TABLE/GATHER_TABLE 對應：battle() 額外事件的道具獎勵、fish()/gather() 本身
// 都要抽到這些名字，放在檔案最上層用同一個 beforeAll 種好，不用管哪個 describe 先跑
const FISH_NAMES = [
  "小魚乾", "泥鰍", "吳郭魚",
  "虹鱒", "鯖魚", "花枝",
  "銀鱗鮭", "龍虎斑", "紅魽",
  "深海鮟鱇魚", "電鰻", "小鯊魚",
  "黃金鯉魚", "傳說錦鯉", "神秘魚王",
];

const GATHER_NAMES = [
  "樹枝", "石頭", "麻繩",
  "鐵礦", "煤炭", "硬木",
  "銀礦", "玉石", "陳年木材",
  "金礦", "藍水晶", "魔力碎片",
  "紫水晶", "星隕石", "遠古符文石",
];

beforeAll(async () => {
  for (const name of FISH_NAMES) {
    await prisma.item.upsert({
      where: { name },
      create: {
        name,
        description: "測試用魚",
        type: "fish",
        rarity: "common",
        cost: 10,
        effectType: "none",
        effectValue: 0,
      },
      update: {},
    });
  }
  for (const name of GATHER_NAMES) {
    await prisma.item.upsert({
      where: { name },
      create: {
        name,
        description: "測試用材料",
        type: "material",
        rarity: "common",
        cost: 10,
        effectType: "none",
        effectValue: 0,
      },
      update: {},
    });
  }
});

describe("RPGService.getOrCreateUser", () => {
  it("建立新使用者後，可以用同一個 discordUserId 查回同一筆資料", async () => {
    const discordUserId = `test-getorcreate-${Date.now()}`;

    const created = await RPGService.getOrCreateUser(discordUserId, "測試玩家");
    const found = await RPGService.findUserByDiscordId(discordUserId);

    expect(found?.id).toBe(created.id);
    expect(found?.level).toBe(1);
    expect(found?.gold).toBe(0);
  });
});

describe("RPGService.getLeaderboard", () => {
  it("依等級高低排序，等級相同時比經驗值高低", async () => {
    // 用遠高於其他測試會用到的等級，確保這幾筆一定排在最前面，不受其他測試資料干擾
    const { user: userA } = await createTestUser({ level: 500, xp: 100 });
    const { user: userB } = await createTestUser({ level: 500, xp: 200 });
    const { user: userC } = await createTestUser({ level: 400, xp: 999999 });

    const leaderboard = await RPGService.getLeaderboard(10);

    expect(leaderboard[0].id).toBe(userB.id); // 等級同為 500，經驗較高的排前面
    expect(leaderboard[1].id).toBe(userA.id);
    expect(leaderboard[2].id).toBe(userC.id); // 等級較低，經驗再高也排在後面
  });
});

describe("xpThresholdForLevel", () => {
  it("是平方成長，等級越高門檻拉開得越快", () => {
    expect(xpThresholdForLevel(2)).toBe(200);
    expect(xpThresholdForLevel(18)).toBe(16200);
    // 越級的差距要比線性成長時大，驗證真的是平方而不是線性
    const gapAt5 = xpThresholdForLevel(6) - xpThresholdForLevel(5);
    const gapAt15 = xpThresholdForLevel(16) - xpThresholdForLevel(15);
    expect(gapAt15).toBeGreaterThan(gapAt5);
  });
});

describe("RPGService.battle", () => {
  it("使用者不存在時拋出錯誤", async () => {
    await expect(RPGService.battle("never-started-user")).rejects.toThrow("使用者不存在");
  });

  it("屬性壓倒性領先時保證獲勝，且贏了會加金幣跟經驗值", async () => {
    const { discordUserId, user } = await createTestUser({
      attack: 9999,
      defense: 9999,
      health: 100,
      maxHealth: 100,
    });

    const result = await RPGService.battle(discordUserId);

    expect(result.result).toBe("win");
    expect(result.user.gold).toBeGreaterThan(user.gold);
    expect(result.user.xp).toBeGreaterThan(user.xp);
    // 攻擊力壓倒性領先，一擊必殺，回合數要是 1
    expect(result.rounds).toBe(1);
  });

  it("屬性壓倒性落後時保證落敗，血量掉到約 30% 上限", async () => {
    const { discordUserId } = await createTestUser({
      attack: 1,
      defense: 0,
      health: 1,
      maxHealth: 100,
    });

    const result = await RPGService.battle(discordUserId);

    expect(result.result).toBe("lose");
    expect(result.user.health).toBe(30);
    // 開戰前血量是 1，結束後變 30，healthDelta 要精準反映這個差額，不能只回傳絕對值
    expect(result.healthDelta).toBe(29);
    // 血量只有 1，敵人第一次反擊就會把玩家打死，回合數要是 1
    expect(result.rounds).toBe(1);
  });

  it("戰鬥後 30 秒內再戰會被冷卻擋下", async () => {
    const { discordUserId } = await createTestUser({ attack: 9999, defense: 9999 });
    await RPGService.battle(discordUserId);

    await expect(RPGService.battle(discordUserId)).rejects.toThrow("冷卻中");
  });

  it("升級時會把生命值直接補滿到新的上限，而不是只加一點", async () => {
    const { discordUserId, user } = await createTestUser({
      attack: 9999,
      defense: 9999,
      health: 20,
      maxHealth: 100,
      xp: xpThresholdForLevel(2) - 1, // 這場戰鬥穩贏，經驗值也穩過 Lv2 門檻
    });

    const result = await RPGService.battle(discordUserId);

    expect(result.user.level).toBeGreaterThan(user.level);
    expect(result.user.health).toBe(result.user.maxHealth);
  });

  it("有生命上限加成的裝備時，effectiveMaxHealth 要包含裝備加成，不能只回傳資料庫的基礎值", async () => {
    const { discordUserId, user } = await createTestUser({
      gold: 1000,
      // 等級拉高只是為了讓升級門檻高到不可能被打贏後額外事件的獎勵經驗值碰到，
      // 避免這個斷言偶爾因為升級全滿血、蓋掉這裡要驗證的「基礎值 + 裝備加成」而變得不穩定
      level: 999,
      attack: 9999,
      defense: 9999,
      health: 100,
      maxHealth: 100,
    });
    const accessory = await createTestItem({
      type: "accessory",
      cost: 100,
      effectType: "maxHealth",
      effectValue: 50,
    });
    await ItemService.buyItem(user.id, accessory.name); // 自動裝上（空欄位）

    const result = await RPGService.battle(discordUserId);

    expect(result.effectiveMaxHealth).toBe(150); // 基礎 100 + 裝備 50
  });

  it("閃避率 100% 的裝備讓玩家完全不會被打中，原本必敗的屬性也能獲勝", async () => {
    const { discordUserId, user } = await createTestUser({
      gold: 1000,
      attack: 1,
      defense: 0,
      health: 1,
      maxHealth: 100,
    });
    const accessory = await createTestItem({
      type: "accessory",
      cost: 100,
      effectType: "dodgeRate",
      effectValue: 100,
    });
    await ItemService.buyItem(user.id, accessory.name);

    const result = await RPGService.battle(discordUserId);

    // 攻擊力很低但每回合都能造成至少 1 點傷害，敵人終究會被磨死；
    // 100% 閃避讓玩家完全不會掉血，贏了之後至少會有原本就有的「+10」勝利回血；
    // 打贏後還有機率額外觸發菁英怪（同樣吃 100% 閃避、不可能輸），或額外事件的經驗值把等級推過門檻、
    // 觸發升級全滿血，這兩種情況都只會讓血量「更高」，不會比 +10 低
    expect(result.result).toBe("win");
    expect(result.healthDelta).toBeGreaterThanOrEqual(10);
  });

  it("金幣加成裝備存在時，戰鬥獲得的金幣要比沒有加成時可能拿到的上限還高", async () => {
    const { discordUserId, user } = await createTestUser({
      gold: 1000,
      attack: 9999,
      defense: 9999,
    });
    const accessory = await createTestItem({
      type: "accessory",
      cost: 100,
      effectType: "goldBonus",
      effectValue: 200,
    });
    await ItemService.buyItem(user.id, accessory.name);

    const result = await RPGService.battle(discordUserId);

    // 沒有加成時，goldGained 上限是 5 + enemyLevel(最大 2)*2 + randomInt 上限 4 = 13；
    // +200% 加成後一定會超過這個沒加成時能拿到的最高值
    expect(result.result).toBe("win");
    expect(result.goldGained).toBeGreaterThan(13);
  });

  it("打輸主戰鬥不會擲額外事件", async () => {
    const { discordUserId } = await createTestUser({ attack: 1, defense: 0, health: 1, maxHealth: 100 });

    const result = await RPGService.battle(discordUserId);

    expect(result.result).toBe("lose");
    expect(result.bonusEvents).toEqual([]);
  });

  it("打贏後有機率額外觸發金幣/道具/菁英怪事件，型別要是這三種之一", async () => {
    const { discordUserId } = await createTestUser({ attack: 9999, defense: 9999 });

    // 額外事件是機率性的（35%/20% 各自獨立），重試到至少出現一次為止，避免測試因為運氣不好而不穩定
    let result;
    for (let i = 0; i < 50; i++) {
      result = await RPGService.battle(discordUserId);
      if (result.bonusEvents.length > 0) break;
      await prisma.user.update({ where: { userId: discordUserId }, data: { lastBattle: null } });
    }

    expect(result?.bonusEvents.length).toBeGreaterThan(0);
    for (const event of result!.bonusEvents) {
      expect(["gold", "item", "elite"]).toContain(event.type);
    }
  });

  it("額外事件抽到道具時，要真的把道具加進背包，不是只回傳道具資訊", async () => {
    const { discordUserId, user } = await createTestUser({ attack: 9999, defense: 9999 });

    let itemEvent;
    for (let i = 0; i < 60; i++) {
      const result = await RPGService.battle(discordUserId);
      itemEvent = result.bonusEvents.find((e) => e.type === "item");
      if (itemEvent) break;
      await prisma.user.update({ where: { userId: discordUserId }, data: { lastBattle: null } });
    }

    expect(itemEvent).toBeDefined();
    if (itemEvent && itemEvent.type === "item") {
      const inventory = await ItemService.getInventory(user.id);
      const row = inventory.find((r) => r.itemId === itemEvent.item.id);
      expect(row?.quantity).toBe(itemEvent.quantity);
    }
  });
});

describe("RPGService.dungeon", () => {
  it("使用者不存在時回傳 not_started", async () => {
    const result = await RPGService.dungeon("never-started-dungeon");
    expect(result.status).toBe("not_started");
  });

  it("5 分鐘內再挑戰會被冷卻擋下", async () => {
    const { discordUserId } = await createTestUser({ attack: 9999, defense: 9999 });
    await RPGService.dungeon(discordUserId);

    const second = await RPGService.dungeon(discordUserId);

    expect(second.status).toBe("cooldown");
    if (second.status === "cooldown") {
      expect(second.remainingSeconds).toBeGreaterThan(0);
      expect(second.remainingSeconds).toBeLessThanOrEqual(5 * 60);
    }
  });

  it("屬性壓倒性領先時，四層全部一擊必殺、不掉血，並且拿到全通關獎勵", async () => {
    const { discordUserId, user } = await createTestUser({
      attack: 9999,
      defense: 9999,
      health: 100,
      maxHealth: 100,
    });

    const result = await RPGService.dungeon(discordUserId);

    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.clearedAllFloors).toBe(true);
      expect(result.floors).toHaveLength(4);
      expect(result.floors.every((f) => f.result === "win" && f.rounds === 1)).toBe(true);
      expect(result.completionBonusGold).toBeGreaterThan(0);
      expect(result.completionBonusXp).toBeGreaterThan(0);
      // 每層一擊必殺、敵人完全沒機會反擊，血量不該掉，加上每層過關的 +10 回血封頂，最終應該還是滿血
      expect(result.user.health).toBe(result.user.maxHealth);
      expect(result.user.gold).toBeGreaterThan(user.gold);
    }
  });

  it("屬性壓倒性落後時，第一層就落敗，只拿到那一層的安慰經驗值，沒有全通關獎勵", async () => {
    const { discordUserId } = await createTestUser({
      attack: 1,
      defense: 0,
      health: 1,
      maxHealth: 100,
    });

    const result = await RPGService.dungeon(discordUserId);

    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.clearedAllFloors).toBe(false);
      expect(result.floors).toHaveLength(1);
      expect(result.floors[0].result).toBe("lose");
      expect(result.completionBonusGold).toBe(0);
      expect(result.completionBonusXp).toBe(0);
      expect(result.totalXpGained).toBe(result.floors[0].xpGained);
    }
  });
});

describe("RPGService.fish", () => {
  it("尚未開始遊戲的使用者回傳 not_started", async () => {
    const result = await RPGService.fish("never-started-fisher");
    expect(result.status).toBe("not_started");
  });

  it("釣到魚時會加進背包、增加經驗值，且魚名一定在魚類表裡", async () => {
    const { discordUserId, user } = await createTestUser();

    // 空軍機率 20%，重試幾次直到釣到魚，避免測試因為運氣不好而不穩定
    let result;
    for (let i = 0; i < 30; i++) {
      result = await RPGService.fish(discordUserId);
      if (result.status === "caught") break;
      await prisma.user.update({ where: { userId: discordUserId }, data: { lastFish: null } });
    }

    expect(result?.status).toBe("caught");
    if (result?.status === "caught") {
      expect(FISH_NAMES).toContain(result.item.name);
      expect(result.quantity).toBeGreaterThan(0);
      expect(result.xpGained).toBeGreaterThan(0);
    }

    const updatedUser = await RPGService.findUserByDiscordId(discordUserId);
    expect(updatedUser!.xp).toBeGreaterThan(user.xp);
  });

  it("1 分鐘內再釣會被冷卻擋下", async () => {
    const { discordUserId } = await createTestUser();
    await RPGService.fish(discordUserId);

    const second = await RPGService.fish(discordUserId);

    expect(second.status).toBe("cooldown");
    if (second.status === "cooldown") {
      expect(second.remainingSeconds).toBeGreaterThan(0);
      expect(second.remainingSeconds).toBeLessThanOrEqual(60);
    }
  });

  it("經驗加成裝備存在時，釣魚拿到的經驗值要比沒有加成時可能拿到的上限還高", async () => {
    const { discordUserId, user } = await createTestUser({ gold: 1000 });
    const accessory = await createTestItem({
      type: "accessory",
      cost: 100,
      effectType: "xpBonus",
      effectValue: 300,
    });
    await ItemService.buyItem(user.id, accessory.name);

    // 空軍機率 5%，重試幾次直到釣到魚，避免測試因為運氣不好而不穩定
    let result;
    for (let i = 0; i < 30; i++) {
      result = await RPGService.fish(discordUserId);
      if (result.status === "caught") break;
      await prisma.user.update({ where: { userId: discordUserId }, data: { lastFish: null } });
    }

    // 沒有加成時 xpGained 上限是 randomInt(2,6) 最大 5；+300% 加成後一定會超過這個沒加成時的最高值
    expect(result?.status).toBe("caught");
    if (result?.status === "caught") {
      expect(result.xpGained).toBeGreaterThan(5);
    }
  });
});

describe("RPGService.gather", () => {
  it("尚未開始遊戲的使用者回傳 not_started", async () => {
    const result = await RPGService.gather("never-started-gatherer");
    expect(result.status).toBe("not_started");
  });

  it("採集到材料時會加進背包、增加經驗值，且材料名一定在材料表裡", async () => {
    const { discordUserId, user } = await createTestUser();

    // 空軍機率 5%，重試幾次直到採到東西，避免測試因為運氣不好而不穩定
    let result;
    for (let i = 0; i < 30; i++) {
      result = await RPGService.gather(discordUserId);
      if (result.status === "gathered") break;
      await prisma.user.update({ where: { userId: discordUserId }, data: { lastGather: null } });
    }

    expect(result?.status).toBe("gathered");
    if (result?.status === "gathered") {
      expect(GATHER_NAMES).toContain(result.item.name);
      expect(result.quantity).toBeGreaterThan(0);
      expect(result.xpGained).toBeGreaterThan(0);
    }

    const updatedUser = await RPGService.findUserByDiscordId(discordUserId);
    expect(updatedUser!.xp).toBeGreaterThan(user.xp);
  });

  it("1 分鐘內再採集會被冷卻擋下", async () => {
    const { discordUserId } = await createTestUser();
    await RPGService.gather(discordUserId);

    const second = await RPGService.gather(discordUserId);

    expect(second.status).toBe("cooldown");
    if (second.status === "cooldown") {
      expect(second.remainingSeconds).toBeGreaterThan(0);
      expect(second.remainingSeconds).toBeLessThanOrEqual(60);
    }
  });
});

describe("RPGService.claimDaily", () => {
  it("尚未開始遊戲的使用者回傳 not_started", async () => {
    const result = await RPGService.claimDaily("never-started-daily");
    expect(result.status).toBe("not_started");
  });

  it("第一次簽到會成功，並把連續登入天數設為 1", async () => {
    const { discordUserId } = await createTestUser();

    const result = await RPGService.claimDaily(discordUserId);

    expect(result.status).toBe("claimed");
    if (result.status === "claimed") {
      expect(result.streak).toBe(1);
      expect(result.finalGoldReward).toBeGreaterThan(0);
    }
  });

  it("同一天內重複簽到會被拒絕", async () => {
    const { discordUserId } = await createTestUser();
    await RPGService.claimDaily(discordUserId);

    const second = await RPGService.claimDaily(discordUserId);

    expect(second.status).toBe("already_claimed");
  });

  it("有生命上限加成的裝備、血量已經高於基礎上限時，簽到補血不能倒扣血量", async () => {
    const { discordUserId, user } = await createTestUser({
      gold: 1000,
      health: 140, // 高於基礎上限 100，低於有效上限 150（例如剛靠戰鬥補到這個血量）
      maxHealth: 100,
    });
    const accessory = await createTestItem({
      type: "accessory",
      cost: 100,
      effectType: "maxHealth",
      effectValue: 50,
    });
    await ItemService.buyItem(user.id, accessory.name); // 自動裝上，有效上限變 150

    const result = await RPGService.claimDaily(discordUserId);

    expect(result.status).toBe("claimed");
    if (result.status === "claimed") {
      expect(result.effectiveMaxHealth).toBe(150);
      // 修 bug 前：用基礎值 100 封頂，140 會被砍到 100，等於簽到扣血
      expect(result.updatedUser.health).toBeGreaterThanOrEqual(140);
    }
  });

  it("金幣加成裝備存在時，簽到拿到的金幣要比沒有加成時可能拿到的上限還高", async () => {
    const { discordUserId, user } = await createTestUser({ gold: 1000 });
    const accessory = await createTestItem({
      type: "accessory",
      cost: 100,
      effectType: "goldBonus",
      effectValue: 100,
    });
    await ItemService.buyItem(user.id, accessory.name);

    const result = await RPGService.claimDaily(discordUserId);

    // Lv1 沒有加成時，goldReward 上限是 round((50+4)*1.1) = 59；+100% 加成後一定會超過這個上限
    expect(result.status).toBe("claimed");
    if (result.status === "claimed") {
      expect(result.goldReward).toBeGreaterThan(59);
    }
  });
});
