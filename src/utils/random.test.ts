import { describe, it, expect } from "vitest";
import { randomInt, randomChance, randomPercentChance } from "./random";

describe("randomInt", () => {
  // 「max 不包含」是其他程式碼的隱含前提：pickFromWeightedTiers、rollEnemy 等地方都直接
  // 拿它當陣列索引用（randomInt(0, arr.length)），改壞這個語意會變成偶發的 undefined
  it("回傳值落在 [min, max) 之間，不會抽到 max", () => {
    const results = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      results.add(randomInt(0, 3));
    }
    expect([...results].sort()).toEqual([0, 1, 2]);
  });

  it("支援負數下界", () => {
    for (let i = 0; i < 500; i++) {
      const value = randomInt(-2, 3);
      expect(value).toBeGreaterThanOrEqual(-2);
      expect(value).toBeLessThanOrEqual(2);
    }
  });
});

describe("randomChance", () => {
  it("機率 0 永遠是 false、機率 1 永遠是 true", () => {
    for (let i = 0; i < 200; i++) {
      expect(randomChance(0)).toBe(false);
      expect(randomChance(1)).toBe(true);
    }
  });
});

describe("randomPercentChance", () => {
  it("0% 永遠是 false、100% 永遠是 true", () => {
    for (let i = 0; i < 200; i++) {
      expect(randomPercentChance(0)).toBe(false);
      expect(randomPercentChance(100)).toBe(true);
    }
  });
});
