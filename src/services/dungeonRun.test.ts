import { describe, it, expect } from "vitest";
import {
  dungeonEnemyLevel,
  floorReward,
  materialFloor,
  MATERIAL_EVERY_N_FLOORS,
  REWARD_GROWTH_PER_FLOOR,
  AUTO_DESCEND_SURVIVAL_THRESHOLD,
  estimateSurvival,
  rollDungeonFloor,
} from "./dungeonRun";
import type { EffectiveStats } from "./itemService";

const stats = (overrides: Partial<EffectiveStats> = {}): EffectiveStats => ({
  attack: 176,
  defense: 88,
  maxHealth: 1350,
  critRate: 0,
  dodgeRate: 0,
  goldBonus: 0,
  xpBonus: 0,
  ...overrides,
});

describe("dungeonEnemyLevel", () => {
  it("第一層貼著玩家等級，之後每層 +2", () => {
    // 隨機偏移設成 0 才測得到坡度本身
    expect(dungeonEnemyLevel(40, 1, 0)).toBe(38);
    expect(dungeonEnemyLevel(40, 2, 0)).toBe(40);
    expect(dungeonEnemyLevel(40, 5, 0)).toBe(46);
  });

  it("偏移會套上去，但等級不會低於 1", () => {
    expect(dungeonEnemyLevel(40, 1, 6)).toBe(44);
    expect(dungeonEnemyLevel(1, 1, -6)).toBe(1);
  });
});

describe("floorReward", () => {
  it("每層獎勵以固定倍率成長，讓深層值得賭", () => {
    const first = floorReward(1);
    const second = floorReward(2);

    expect(second / first).toBeCloseTo(REWARD_GROWTH_PER_FLOOR, 5);
  });

  it("成長率讓「推一層」的期望值跟「收手」接近，決策才有意義", () => {
    // 站在第 8 層打完、存活率 60% 的情況：推的期望值不該壓倒性勝過收手
    const banked = Array.from({ length: 8 }, (_, i) => floorReward(i + 1)).reduce(
      (a, b) => a + b,
      0
    );
    const pushEV = 0.6 * (banked + floorReward(9));

    // 兩者相差在 20% 以內才算「接近」；差太多就變成永遠該推或永遠該收
    expect(Math.abs(pushEV - banked) / banked).toBeLessThan(0.2);
  });
});

describe("materialFloor", () => {
  it("每 4 層一件，但第一件落在第 2 層——新手只走得到 1~2 層，放第 4 層等於一件都拿不到", () => {
    expect(MATERIAL_EVERY_N_FLOORS).toBe(4);
    expect(materialFloor(2)).toBe(true);
    expect(materialFloor(6)).toBe(true);
    expect(materialFloor(10)).toBe(true);
    expect(materialFloor(1)).toBe(false);
    expect(materialFloor(4)).toBe(false);
    expect(materialFloor(7)).toBe(false);
  });
});

describe("estimateSurvival", () => {
  it("打得贏的層回報接近 1，打不贏的回報接近 0", () => {
    const s = stats();
    const easy = { name: "史萊姆", level: 5, health: 130, attack: 18, defense: 9 };
    const lethal = { name: "深淵魔王", level: 300, health: 3080, attack: 608, defense: 304 };

    expect(estimateSurvival(s, easy, s.maxHealth)).toBeGreaterThan(0.95);
    expect(estimateSurvival(s, lethal, s.maxHealth)).toBeLessThan(0.05);
  });

  it("血量越低存活率越低——血量就是下潛的燃料", () => {
    const s = stats();
    const enemy = { name: "怪", level: 50, health: 580, attack: 108, defense: 54 };

    const full = estimateSurvival(s, enemy, s.maxHealth);
    const hurt = estimateSurvival(s, enemy, Math.floor(s.maxHealth * 0.2));

    expect(full).toBeGreaterThan(hurt);
  });
});

describe("rollDungeonFloor", () => {
  it("擲出來的層會帶著敵人與這層是否給材料", () => {
    const floor = rollDungeonFloor(40, 2);

    expect(floor.floor).toBe(2);
    expect(floor.givesMaterial).toBe(true);
    expect(floor.enemy.level).toBeGreaterThan(0);
    expect(floor.goldReward).toBeGreaterThan(0);
  });

  it("詞綴只會是認得的那幾種，而且會反映在敵人數值上", () => {
    const seen = new Set<string | null>();
    for (let i = 0; i < 200; i++) seen.add(rollDungeonFloor(40, 3).affix);

    for (const affix of seen) {
      expect([null, "berserk", "tough"]).toContain(affix);
    }
    // 200 次至少會抽到一次詞綴跟一次沒詞綴，不然就是機率寫死了
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("AUTO_DESCEND_SURVIVAL_THRESHOLD", () => {
  it("門檻要夠高，自動下潛才不會替玩家做掉真正的決策", () => {
    expect(AUTO_DESCEND_SURVIVAL_THRESHOLD).toBeGreaterThanOrEqual(0.9);
    expect(AUTO_DESCEND_SURVIVAL_THRESHOLD).toBeLessThan(1);
  });
});
