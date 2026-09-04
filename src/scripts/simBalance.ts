// 平衡模擬：用 combat.ts 裡「真正在跑的」公式跑蒙地卡羅，把戰鬥難度曲線印成表。
// 改任何戰鬥數值之前先跑這支腳本看表，不要憑感覺調（過去調稀有度權重、地下城倍率、
// 死亡螺旋保底都是臨時寫個腳本跑完就刪，這支是固定下來的版本）。
//
//   npm run sim:balance
//
// 刻意只依賴 combat.ts（純函式、不碰資料庫），所以不需要 DATABASE_URL 也能跑。
import {
  healOnWin,
  lossHealthFloor,
  rollEnemy,
  rollEnemyLevel,
  simulateCombat,
  xpThresholdForLevel,
} from "../services/combat";
import type { EffectiveStats } from "../services/itemService";

const TRIALS = 2000;
const CHAIN_LENGTH = 30; // 連續場次模擬時每次連打幾場
const LEVELS = [1, 5, 6, 10, 20, 40, 80];

// 玩家基礎屬性：Lv1 是 攻10/防5/血100（見 prisma/schema.prisma 的預設值），
// 每升一級 +2 攻 / +1 防 / +10 血（見 combat.ts 的 LEVEL_UP_* 常數）
function baseStatsAtLevel(level: number) {
  return {
    attack: 10 + (level - 1) * 2,
    defense: 5 + (level - 1) * 1,
    maxHealth: 100 + (level - 1) * 10,
  };
}

// 各階段裝備的代表性加成。刻意寫死而不是從資料庫讀——這支腳本要保持純函式、不依賴 DB，
// 而且這裡要比較的是「曲線形狀」，不是驗證某一件裝備的數值。
// 對應的實際裝備（改商店/鍛造數值時記得回來同步）：
//   新手套　：木劍 +5 攻、皮革護甲 +3 防（/rpg start 的新手背包）
//   中期套　：秘銀劍 +45 攻、秘銀鎧甲 +32 防、不死鳥之心 +100 血 左右的等級
//   神話級　：屠龍劍 +80 攻、龍鱗甲 +58 防 加上神話飾品
const GEAR_PRESETS: { label: string; attack: number; defense: number; maxHealth: number }[] = [
  { label: "無裝備", attack: 0, defense: 0, maxHealth: 0 },
  { label: "新手套", attack: 5, defense: 3, maxHealth: 0 },
  { label: "中期套", attack: 30, defense: 20, maxHealth: 50 },
  { label: "神話級", attack: 80, defense: 60, maxHealth: 150 },
];

function statsFor(level: number, gear: (typeof GEAR_PRESETS)[number]): EffectiveStats {
  const base = baseStatsAtLevel(level);
  return {
    attack: base.attack + gear.attack,
    defense: base.defense + gear.defense,
    maxHealth: base.maxHealth + gear.maxHealth,
    // 爆擊/閃避先不計入：這兩個只有部分裝備才有，混進來會看不出基礎盤的問題
    critRate: 0,
    dodgeRate: 0,
    goldBonus: 0,
    xpBonus: 0,
  };
}

/** 滿血開打一場的勝率——看的是「戰鬥公式本身公不公平」 */
function singleFightWinRate(level: number, stats: EffectiveStats): number {
  let wins = 0;
  for (let i = 0; i < TRIALS; i++) {
    const enemy = rollEnemy(rollEnemyLevel(level), ["模擬敵人"]);
    if (simulateCombat(stats, enemy, stats.maxHealth).result === "win") wins++;
  }
  return wins / TRIALS;
}

/**
 * 連續打 CHAIN_LENGTH 場的勝率，血量在場次之間延續、不喝藥水
 * （贏了照 healOnWin 回一點，輸了砍到 lossHealthFloor 繼續打）。
 * 看的是「死亡螺旋」——單場滿血明明打得贏，但血量一旦掉下去就再也爬不回來。
 */
function chainWinRate(level: number, stats: EffectiveStats): number {
  let wins = 0;
  let fights = 0;
  for (let i = 0; i < TRIALS / 10; i++) {
    let health = stats.maxHealth;
    for (let f = 0; f < CHAIN_LENGTH; f++) {
      const enemy = rollEnemy(rollEnemyLevel(level), ["模擬敵人"]);
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

function printTable(title: string, compute: (level: number, stats: EffectiveStats) => number): void {
  console.log(`\n${title}`);
  console.log(["等級".padEnd(6), ...GEAR_PRESETS.map((g) => g.label.padStart(8))].join(""));
  for (const level of LEVELS) {
    const cells = GEAR_PRESETS.map((gear) => {
      const rate = compute(level, statsFor(level, gear));
      return `${(rate * 100).toFixed(0)}%`.padStart(8);
    });
    console.log([`Lv${level}`.padEnd(6), ...cells].join(""));
  }
}

function printPacing(): void {
  console.log("\n【升級節奏】每升一級平均要打幾場（不含加成、以敵人等級 ≈ 玩家等級計）");
  console.log(["等級".padEnd(6), "門檻差距".padStart(12), "每場經驗".padStart(10), "場數".padStart(8)].join(""));
  for (const level of LEVELS) {
    const gap = xpThresholdForLevel(level + 1) - xpThresholdForLevel(level);
    const perFight = 10 + level * 5 + 3; // battle() 勝利經驗：10 + 敵人等級*5 + randomInt(1,6)
    console.log(
      [
        `Lv${level}`.padEnd(6),
        String(gap).padStart(12),
        String(perFight).padStart(10),
        (gap / perFight).toFixed(1).padStart(8),
      ].join("")
    );
  }
}

// 用固定種子的 PRNG 暫時取代 Math.random，讓每次跑出來的表完全一致：
// 比較「改公式前 vs 改公式後」時，才分得出是真的有差還是只是雜訊。
// 全專案的亂數都走 utils/random.ts 的 Math.random，所以換這一個就夠了。
function withSeededRandom(seed: number, run: () => void): void {
  const original = Math.random;
  let state = seed;
  Math.random = () => {
    // mulberry32：夠均勻、夠快，且不需要額外依賴
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    run();
  } finally {
    Math.random = original;
  }
}

withSeededRandom(20260904, () => {
  console.log(`平衡模擬（每格 ${TRIALS} 次、連續場次每輪 ${CHAIN_LENGTH} 場、固定亂數種子）`);
  printTable("【單場勝率】滿血開打，看戰鬥公式本身", singleFightWinRate);
  console.log(
    "  註：數值會卡在 25% 的倍數附近不是雜訊——敵人等級只有 4 種等機率結果（玩家等級 -2 ~ +1），\n" +
      "  而每一種對上同一組裝備通常是決定性的輸或贏，所以勝率是階梯函數而不是平滑曲線。"
  );
  printTable(`【連續場次勝率】血量延續、不喝藥水，看死亡螺旋`, chainWinRate);
  printPacing();
  console.log("");
});
