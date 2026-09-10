import { describe, it, expect } from "vitest";
import {
  JOB_KEYS,
  JOB_LABELS,
  JOB_UNLOCK_LEVEL,
  JOB_CHANGE_COST,
  isJobKey,
  dungeonMaterialIntervalOverride,
  enhanceLevelLossFromOverride,
  gatherRollCount,
  harvestEmptyChanceOverride,
  maxBattleStreak,
} from "./jobs";

describe("職業定義", () => {
  it("四個職業各對應一個遊戲系統，都有中文名字", () => {
    expect(JOB_KEYS).toHaveLength(4);
    for (const key of JOB_KEYS) {
      expect(JOB_LABELS[key]).toBeTruthy();
    }
  });

  it("isJobKey 擋得掉資料庫裡的爛值", () => {
    expect(isJobKey("smith")).toBe(true);
    expect(isJobKey("wizard")).toBe(false);
    expect(isJobKey(null)).toBe(false);
    expect(isJobKey("")).toBe(false);
  });

  it("轉職門檻與變更費用是定案的那兩個數字", () => {
    expect(JOB_UNLOCK_LEVEL).toBe(30);
    expect(JOB_CHANGE_COST).toBe(20_000);
  });
});

describe("每個被動只覆寫自己那個系統的常數", () => {
  it("深淵掠者把地下城材料里程碑改成每 3 層，其他職業不動它", () => {
    expect(dungeonMaterialIntervalOverride("delver")).toBe(3);
    for (const key of JOB_KEYS.filter((k) => k !== "delver")) {
      expect(dungeonMaterialIntervalOverride(key)).toBeNull();
    }
    expect(dungeonMaterialIntervalOverride(null)).toBeNull();
  });

  it("星火匠神把失敗退級的門檻從 +6 推到 +8", () => {
    expect(enhanceLevelLossFromOverride("smith")).toBe(8);
    for (const key of JOB_KEYS.filter((k) => k !== "smith")) {
      expect(enhanceLevelLossFromOverride(key)).toBeNull();
    }
    expect(enhanceLevelLossFromOverride(null)).toBeNull();
  });

  it("荒野獵者釣魚採集擲兩次骰子，其他人擲一次", () => {
    expect(gatherRollCount("forager")).toBe(2);
    for (const key of JOB_KEYS.filter((k) => k !== "forager")) {
      expect(gatherRollCount(key)).toBe(1);
    }
    expect(gatherRollCount(null)).toBe(1);
  });

  it("荒野獵者絕對不會空手，其他職業照樣有空手率", () => {
    expect(harvestEmptyChanceOverride("forager")).toBe(0);
    for (const key of JOB_KEYS.filter((k) => k !== "forager")) {
      expect(harvestEmptyChanceOverride(key)).toBeNull();
    }
    expect(harvestEmptyChanceOverride(null)).toBeNull();
  });

  it("血戰鬥神可以連戰 5 場，其他人一場就進冷卻", () => {
    expect(maxBattleStreak("berserker")).toBe(5);
    for (const key of JOB_KEYS.filter((k) => k !== "berserker")) {
      expect(maxBattleStreak(key)).toBe(1);
    }
    expect(maxBattleStreak(null)).toBe(1);
  });

  it("沒有職業時，每一個覆寫都回到預設值——被動不會憑空生效", () => {
    expect(dungeonMaterialIntervalOverride(null)).toBeNull();
    expect(enhanceLevelLossFromOverride(null)).toBeNull();
    expect(gatherRollCount(null)).toBe(1);
    expect(harvestEmptyChanceOverride(null)).toBeNull();
    expect(maxBattleStreak(null)).toBe(1);
  });
});
