/**
 * 地下城下潛的平衡模擬（npm run sim:dungeon）。
 *
 * 用的是 dungeonRun.ts 真正會上線的常數，不是另外抄一份——改了那邊的旋鈕就在這裡重跑，
 * 直接看到新手/中期/鯨魚各會下潛多深、決策點落在哪、一趟拿幾件材料。
 */
import {
  rollDungeonFloor,
  estimateSurvival,
  AUTO_DESCEND_SURVIVAL_THRESHOLD,
  MAX_DUNGEON_FLOOR,
  REWARD_GROWTH_PER_FLOOR,
  MATERIAL_EVERY_N_FLOORS,
} from "../services/dungeonRun";
import { simulateCombat } from "../services/combat";
import type { EffectiveStats } from "../services/itemService";

const stats = (
  attack: number,
  defense: number,
  maxHealth: number,
  critRate = 0,
  dodgeRate = 0
): EffectiveStats => ({
  attack,
  defense,
  maxHealth,
  critRate,
  dodgeRate,
  goldBonus: 0,
  xpBonus: 0,
});

// 對照正式環境的實際角色（2026-09-06 的資料）
const PLAYERS: { label: string; level: number; stats: EffectiveStats }[] = [
  { label: "新手 Lv3（原廠裝）", level: 3, stats: stats(19, 10, 120) },
  { label: "新手 Lv4（買了鎖子甲）", level: 4, stats: stats(28, 16, 130) },
  { label: "Lv20 中階", level: 20, stats: stats(96, 48, 750, 10, 5) },
  { label: "Lv40 高階", level: 40, stats: stats(176, 88, 1350, 15, 8) },
  { label: "Lv76 神話+5", level: 76, stats: stats(320, 160, 2430, 20, 10) },
];

interface RunOutcome {
  /** 自動下潛停下來問玩家的層（＝真正的決策點） */
  decisionFloors: number[];
  /** 玩家如果每次都在決策點收手，會走到第幾層 */
  bankedDepth: number;
  materials: number;
  gold: number;
}

/** 模擬一趟：自動下潛到存活率跌破門檻就停，這裡的策略是「停下來就收手」 */
function simulateCautiousRun(level: number, s: EffectiveStats): RunOutcome {
  let health = s.maxHealth;
  let cleared = 0;
  let materials = 0;
  let gold = 0;
  const decisionFloors: number[] = [];

  for (let floor = 1; floor <= MAX_DUNGEON_FLOOR; floor++) {
    // 模擬的是沒有職業的基準；要看深淵掠者就把 null 換成 "delver"
    const plan = rollDungeonFloor(level, floor, null);
    const survival = estimateSurvival(s, plan.enemy, health);
    if (survival < AUTO_DESCEND_SURVIVAL_THRESHOLD) {
      decisionFloors.push(floor);
      break; // 謹慎策略：一被問就收手
    }
    const combat = simulateCombat(s, plan.enemy, health);
    if (combat.result === "lose") break; // 自動下潛途中翻車（門檻內仍有殘餘風險）
    health = combat.finalHealth;
    cleared = floor;
    gold += plan.goldReward;
    if (plan.givesMaterial) materials++;
  }

  return { decisionFloors, bankedDepth: cleared, materials, gold };
}

const N = 400;

console.log("地下城下潛模擬");
console.log(
  `自動下潛門檻 ${(AUTO_DESCEND_SURVIVAL_THRESHOLD * 100).toFixed(0)}%` +
    `・獎勵成長 ×${REWARD_GROWTH_PER_FLOOR}/層` +
    `・每 ${MATERIAL_EVERY_N_FLOORS} 層一件材料\n`
);
console.log(
  "玩家".padEnd(24) +
    "自動突破".padStart(8) +
    "首個決策點".padStart(12) +
    "材料/趟".padStart(10) +
    "金幣/趟".padStart(10)
);

for (const { label, level, stats: s } of PLAYERS) {
  const runs = Array.from({ length: N }, () => simulateCautiousRun(level, s));
  const avg = (pick: (r: RunOutcome) => number) =>
    runs.reduce((sum, r) => sum + pick(r), 0) / runs.length;
  const decisionAt = runs
    .map((r) => r.decisionFloors[0])
    .filter((f): f is number => f !== undefined);

  console.log(
    label.padEnd(22) +
      avg((r) => r.bankedDepth)
        .toFixed(1)
        .padStart(8) +
      (decisionAt.length > 0
        ? (decisionAt.reduce((a, b) => a + b, 0) / decisionAt.length).toFixed(1)
        : "—"
      ).padStart(12) +
      avg((r) => r.materials)
        .toFixed(2)
        .padStart(10) +
      Math.round(avg((r) => r.gold))
        .toString()
        .padStart(10)
  );
}

console.log(
  "\n對照：改版前是「每 5 分鐘穩拿 2 件材料、零風險」。" +
    "\n材料/趟 接近 2 代表水龍頭沒有被這次改動放大——這次改的是要不要賭，不是產量。"
);
