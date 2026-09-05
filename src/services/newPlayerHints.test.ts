import { describe, it, expect } from "vitest";
import { nextStepHint, NEW_PLAYER_HINT_MAX_LEVEL, type NewPlayerState } from "./newPlayerHints";

// 正式資料裡兩個新手的實際狀態：滿血、有錢、藥水一瓶沒用過、卻好幾天沒戰鬥。
// 他們沒有卡關，只是沒有理由繼續玩，所以這裡的預設就照那個樣子擺
function state(overrides: Partial<NewPlayerState> = {}): NewPlayerState {
  return {
    level: 3,
    health: 120,
    maxHealth: 120,
    gold: 357,
    hasHealingPotion: true,
    lastBattleAt: new Date("2026-09-05T12:00:00Z"),
    affordableUpgrade: null,
    hasGathered: true,
    ...overrides,
  };
}

const NOW = new Date("2026-09-05T13:00:00Z");

describe("nextStepHint", () => {
  it("從來沒戰鬥過的人，先叫他去打第一場", () => {
    const hint = nextStepHint(state({ lastBattleAt: null }), NOW);

    expect(hint).toContain("/rpg battle");
  });

  it("超過一天沒戰鬥就提醒回來打（他們就是這樣流失的）", () => {
    const hint = nextStepHint(state({ lastBattleAt: new Date("2026-09-02T12:00:00Z") }), NOW);

    expect(hint).toContain("/rpg battle");
  });

  it("血量過低又有藥水時，優先叫他先回血再去打", () => {
    const hint = nextStepHint(state({ health: 20, hasHealingPotion: true }), NOW);

    expect(hint).toContain("/rpg use");
  });

  it("血低但沒藥水就不要叫他用藥水，改叫他去簽到回血", () => {
    const hint = nextStepHint(state({ health: 20, hasHealingPotion: false }), NOW);

    expect(hint).not.toContain("/rpg use");
  });

  it("買得起更好的裝備時，直接把名字和價格講出來", () => {
    const hint = nextStepHint(
      state({ affordableUpgrade: { name: "精鋼劍", cost: 500 }, gold: 600 }),
      NOW
    );

    expect(hint).toContain("精鋼劍");
    expect(hint).toContain("/rpg shop");
  });

  it("沒事可提醒時回傳 null，不硬擠一句廢話出來", () => {
    expect(nextStepHint(state(), NOW)).toBeNull();
  });

  it("等級夠高就完全不再顯示，這是給新手的提示不是給老手的雜訊", () => {
    const veteran = state({
      level: NEW_PLAYER_HINT_MAX_LEVEL,
      lastBattleAt: null,
      health: 1,
      affordableUpgrade: { name: "神話之刃", cost: 6500 },
    });

    expect(nextStepHint(veteran, NOW)).toBeNull();
  });
});
