import { describe, it, expect } from "vitest";
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_BUDGET,
  achievedKeys,
  achievementBonus,
  findTitle,
  formatBonus,
  titleText,
  TITLES,
  type AchievementSnapshot,
} from "./achievements";

const EMPTY: AchievementSnapshot = {
  level: 1,
  gold: 0,
  loginStreak: 0,
  maxEnhanceLevel: 0,
  mythicItemCount: 0,
  legendaryMaterialCount: 0,
  job: null,
};

describe("achievedKeys", () => {
  it("剛開始玩的角色什麼都還沒達成", () => {
    expect(achievedKeys(EMPTY)).toEqual([]);
  });

  it("剛好踩到門檻就算達成", () => {
    expect(achievedKeys({ ...EMPTY, level: 10 })).toContain("level_10");
  });

  it("差一點就是還沒達成", () => {
    expect(achievedKeys({ ...EMPTY, level: 9 })).not.toContain("level_10");
  });

  it("超過門檻時，底下每一階都算達成——不會只拿到最高那一階", () => {
    expect(achievedKeys({ ...EMPTY, level: 65 })).toEqual(
      expect.arrayContaining(["level_10", "level_30", "level_60"])
    );
  });
});

describe("achievementBonus", () => {
  it("沒有任何成就就沒有加成", () => {
    expect(achievementBonus([])).toEqual({
      attack: 0,
      defense: 0,
      maxHealth: 0,
      critRate: 0,
      dodgeRate: 0,
    });
  });

  it("全部解鎖時剛好等於預算上限——成就給的能力值有天花板，不會無限長", () => {
    const everything = ACHIEVEMENTS.map((a) => a.key);
    expect(achievementBonus(everything)).toEqual(ACHIEVEMENT_BUDGET);
  });

  it("預算是「2 成的一整套 +10 神話裝」算出來的，不是隨手填的", () => {
    // 一整套 +10 神話裝：攻 360 / 防 250 / 血 300 / 爆擊 40% / 閃避 32%（正式環境的實際數值）
    const fullMythicSet = {
      attack: 360,
      defense: 250,
      maxHealth: 300,
      critRate: 40,
      dodgeRate: 32,
    };
    for (const [stat, gearValue] of Object.entries(fullMythicSet)) {
      const budget = ACHIEVEMENT_BUDGET[stat as keyof typeof fullMythicSet];
      expect(budget / gearValue).toBeCloseTo(0.2, 1);
    }
  });

  it("認不出來的 key 直接忽略，不會讓整個加成計算爆掉", () => {
    // 閾值調動之後資料庫裡可能留著已經不存在的 key
    expect(achievementBonus(["level_10", "this_no_longer_exists"])).toEqual(
      achievementBonus(["level_10"])
    );
  });

  it("同一個成就被記錄兩次也只算一次的份——加總前要去重", () => {
    expect(achievementBonus(["level_10", "level_10"])).toEqual(achievementBonus(["level_10"]));
  });
});

describe("成就清單本身", () => {
  it("key 沒有重複，不然資料庫的 unique 約束會擋掉其中一個", () => {
    const keys = ACHIEVEMENTS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("每個成就都有能力值可拿——沒有純裝飾的成就", () => {
    for (const a of ACHIEVEMENTS) {
      expect(Object.values(a.reward).some((v) => v > 0)).toBe(true);
    }
  });

  it("每個成就都附一個稱號，而且稱號之間不重複", () => {
    const titles = ACHIEVEMENTS.map((a) => a.title);
    expect(titles.every((t) => t.length > 0)).toBe(true);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("稱號", () => {
  it("成就附贈的稱號用成就的 key，商店的稱號另外一組 key，兩邊不會撞在一起", () => {
    const keys = TITLES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("稱號的文字不重複，不然玩家分不出自己掛的是哪一個", () => {
    const texts = TITLES.map((t) => t.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("只有商店的稱號有價格，成就附贈的沒有——那個要靠達成，不能用錢買", () => {
    for (const t of TITLES) {
      if (t.source === "shop") expect(t.cost).toBeGreaterThan(0);
      else expect(t.cost).toBeUndefined();
    }
  });

  it("查得到商店稱號的價格", () => {
    expect(findTitle("shop_newcomer")?.cost).toBe(5_000);
  });

  it("認不出來的稱號 key 當作沒掛稱號，不是顯示那串 key", () => {
    expect(titleText("shop_this_was_removed")).toBeNull();
    expect(titleText(null)).toBeNull();
  });

  it("成就的 key 本身就是它那個稱號的 key", () => {
    expect(titleText("level_60")).toBe("百戰老兵");
  });
});

describe("formatBonus", () => {
  it("只列出不是 0 的項目", () => {
    expect(formatBonus({ attack: 10 })).toBe("攻擊力 +10");
  });

  it("百分比型的屬性帶 %，數值型的不帶", () => {
    expect(formatBonus({ critRate: 2 })).toBe("爆擊率 +2%");
    expect(formatBonus({ maxHealth: 30 })).toBe("生命上限 +30");
  });

  it("多個項目照固定順序列，不會每次顯示的順序都不一樣", () => {
    expect(formatBonus({ dodgeRate: 1, attack: 5 })).toBe("攻擊力 +5、閃避率 +1%");
  });

  it("成就總預算寫出來就是完整的一行", () => {
    expect(formatBonus(ACHIEVEMENT_BUDGET)).toBe(
      "攻擊力 +72、防禦力 +50、生命上限 +60、爆擊率 +8%、閃避率 +6%"
    );
  });
});
