import { describe, it, expect } from "vitest";
import {
  computeLevelUp,
  healOnWin,
  lossHealthFloor,
  rollEnemy,
  rollEnemyLevel,
  simulateCombat,
} from "./combat";
import type { EffectiveStats } from "./itemService";

// 這些是「粗略的平衡回歸測試」，邊界刻意放寬，只擋真正的結構性退化，不是精準驗算。
// 完整的難度曲線看 npm run sim:balance，那支腳本會印出各等級 × 各裝備階段的表。
function statsFor(level: number, gear: { attack: number; defense: number; maxHealth: number }): EffectiveStats {
  return {
    attack: 10 + (level - 1) * 2 + gear.attack,
    defense: 5 + (level - 1) * 1 + gear.defense,
    maxHealth: 100 + (level - 1) * 10 + gear.maxHealth,
    critRate: 0,
    dodgeRate: 0,
    goldBonus: 0,
    xpBonus: 0,
  };
}

const NO_GEAR = { attack: 0, defense: 0, maxHealth: 0 };
const STARTER_KIT = { attack: 5, defense: 3, maxHealth: 0 }; // 木劍 +5 攻、皮革護甲 +3 防

function singleFightWinRate(level: number, stats: EffectiveStats, trials = 600): number {
  let wins = 0;
  for (let i = 0; i < trials; i++) {
    const enemy = rollEnemy(rollEnemyLevel(level), ["測試敵人"]);
    if (simulateCombat(stats, enemy, stats.maxHealth).result === "win") wins++;
  }
  return wins / trials;
}

function chainWinRate(level: number, stats: EffectiveStats, chains = 60, chainLength = 30): number {
  let wins = 0;
  let fights = 0;
  for (let c = 0; c < chains; c++) {
    let health = stats.maxHealth;
    for (let f = 0; f < chainLength; f++) {
      const enemy = rollEnemy(rollEnemyLevel(level), ["測試敵人"]);
      const { result, finalHealth } = simulateCombat(stats, enemy, health);
      fights++;
      if (result === "win") {
        wins++;
        health = healOnWin(finalHealth, stats.maxHealth);
      } else {
        health = lossHealthFloor(stats.maxHealth, level);
      }
    }
  }
  return wins / fights;
}

describe("rollEnemyLevel", () => {
  it("Lv5 以下不會遇到比自己高等的敵人（新手保護）", () => {
    for (const level of [1, 2, 3, 4, 5]) {
      for (let i = 0; i < 300; i++) {
        expect(rollEnemyLevel(level)).toBeLessThanOrEqual(level);
      }
    }
  });

  it("Lv6 以上敵人等級落在玩家等級 -2 ~ +1 之間", () => {
    for (let i = 0; i < 500; i++) {
      const level = rollEnemyLevel(20);
      expect(level).toBeGreaterThanOrEqual(18);
      expect(level).toBeLessThanOrEqual(21);
    }
  });

  it("等級不會低於 1", () => {
    for (let i = 0; i < 200; i++) {
      expect(rollEnemyLevel(1)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("戰鬥平衡回歸", () => {
  // production 真的發生過「新手第一場就輸、還被扣掉大半血」被玩家回報，這條擋的就是那個退化
  it("新手拿著新手背包，第一場滿血戰鬥幾乎穩贏", () => {
    expect(singleFightWinRate(1, statsFor(1, STARTER_KIT))).toBeGreaterThan(0.9);
  });

  it("Lv1 完全沒裝備也打得贏第一場（敵人一定是 Lv1）", () => {
    expect(singleFightWinRate(1, statsFor(1, NO_GEAR))).toBeGreaterThan(0.8);
  });

  // 目前的已知問題：lossHealthFloor 在 Lv5→Lv6 是硬切（80% 掉到 30%），沒買藥水的玩家
  // 連續作戰時勝率直接崩掉。這條測試把「現況」釘住——修好 Lv6 懸崖之後它會變紅燈，
  // 那時候要做的是更新這裡的期望值，不是把測試刪掉
  it("【已知問題】Lv6 沒裝備連續作戰會陷入死亡螺旋，勝率低於兩成", () => {
    expect(chainWinRate(6, statsFor(6, NO_GEAR))).toBeLessThan(0.2);
  });

  it("Lv5 沒裝備連續作戰還撐得住（新手保護的 80% 保底有效）", () => {
    expect(chainWinRate(5, statsFor(5, NO_GEAR))).toBeGreaterThan(0.25);
  });
});

describe("computeLevelUp", () => {
  it("一次獲得大量經驗可以連跨多級，屬性照級數累加", () => {
    // Lv1 門檻 50、Lv2 門檻 200、Lv3 門檻 450：拿到 500 經驗可以一路升到 Lv4
    const result = computeLevelUp(1, 500, 100);

    expect(result.newLevel).toBe(4);
    expect(result.levelsGained).toBe(3);
    expect(result.newMaxHealth).toBe(130); // 100 + 3 * 10
    expect(result.statIncrements).toEqual({
      level: { increment: 3 },
      attack: { increment: 6 },
      defense: { increment: 3 },
      maxHealth: { increment: 30 },
    });
  });

  it("沒升級時不產生任何屬性增量，生命上限維持原值", () => {
    const result = computeLevelUp(5, 100, 200);

    expect(result.levelsGained).toBe(0);
    expect(result.newMaxHealth).toBe(200);
    expect(result.statIncrements).toEqual({});
  });
});

describe("lossHealthFloor", () => {
  it("Lv5 保底是上限的 80%，Lv6 掉到 30%（目前的硬切邊界）", () => {
    expect(lossHealthFloor(200, 5)).toBe(160);
    expect(lossHealthFloor(200, 6)).toBe(60);
  });

  it("再低也至少保留 10 點血", () => {
    expect(lossHealthFloor(10, 50)).toBe(10);
  });
});
