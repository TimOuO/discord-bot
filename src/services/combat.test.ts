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

  it("Lv5 沒裝備連續作戰還撐得住（新手保護的 80% 保底有效）", () => {
    expect(chainWinRate(5, statsFor(5, NO_GEAR))).toBeGreaterThan(0.25);
  });

  // 這條原本釘的是「Lv6 勝率低於兩成」的壞掉現況（硬切保底造成的死亡螺旋），
  // 保底改成 Lv5→Lv15 線性遞減之後如預期變紅燈，這裡把期望值更新成修好後該有的樣子：
  // Lv5 過到 Lv6 不該是斷崖，而是平緩下降
  it("Lv5 過到 Lv6 不會出現斷崖，連續作戰勝率不會腰斬到剩零頭", () => {
    const atLv5 = chainWinRate(5, statsFor(5, NO_GEAR));
    const atLv6 = chainWinRate(6, statsFor(6, NO_GEAR));

    expect(atLv6).toBeGreaterThan(atLv5 * 0.4);
  });

  it("Lv6 帶著新手背包連續作戰站得住腳", () => {
    expect(chainWinRate(6, statsFor(6, STARTER_KIT))).toBeGreaterThan(0.3);
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
  it("Lv5 以下維持 80%，Lv15 以上維持 30%", () => {
    expect(lossHealthFloor(200, 1)).toBe(160);
    expect(lossHealthFloor(200, 5)).toBe(160);
    expect(lossHealthFloor(200, 15)).toBe(60);
    expect(lossHealthFloor(200, 80)).toBe(60);
  });

  it("Lv5 到 Lv15 之間線性遞減，沒有任何一級是斷崖", () => {
    expect(lossHealthFloor(200, 6)).toBe(150); // 75%
    expect(lossHealthFloor(200, 10)).toBe(110); // 55%
    expect(lossHealthFloor(200, 14)).toBe(70); // 35%

    // 相鄰等級之間的落差不該超過整體遞減幅度的一半（也就是不能有硬切）
    for (let level = 1; level < 20; level++) {
      const drop = lossHealthFloor(200, level) - lossHealthFloor(200, level + 1);
      expect(drop).toBeLessThan((160 - 60) / 2);
    }
  });

  it("再低也至少保留 10 點血", () => {
    expect(lossHealthFloor(10, 50)).toBe(10);
  });
});
