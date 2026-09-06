import { describe, it, expect } from "vitest";
import {
  offlineRegen,
  OFFLINE_REGEN_PER_HOUR_RATIO,
  OFFLINE_REGEN_TO_FULL_HOURS,
  msUntilFullHealth,
} from "./combat";

const HOUR = 60 * 60 * 1000;

describe("offlineRegen", () => {
  it("從落敗保底（30%）離線 8 小時剛好回到滿血——這就是速率的錨點", () => {
    const max = 1000;
    const floor = Math.floor(max * 0.3);

    const gain = offlineRegen(floor, max, OFFLINE_REGEN_TO_FULL_HOURS * HOUR);

    expect(floor + gain).toBe(max);
  });

  it("已經滿血就不回", () => {
    expect(offlineRegen(1000, 1000, 24 * HOUR)).toBe(0);
  });

  it("不會回超過上限", () => {
    const gain = offlineRegen(900, 1000, 100 * HOUR);

    expect(gain).toBe(100);
  });

  it("回血量不足 1 點時回傳 0——呼叫端要靠這個判斷「不要推進時鐘」", () => {
    // 新手上限 120，每小時只回 10.5 點；兩分鐘是 0.35 點
    const gain = offlineRegen(60, 120, 2 * 60 * 1000);

    expect(gain).toBe(0);
  });

  it("時間沒有前進（或時鐘倒退）時回 0，不會扣血", () => {
    expect(offlineRegen(500, 1000, 0)).toBe(0);
    expect(offlineRegen(500, 1000, -HOUR)).toBe(0);
  });

  it("回血量是以有效上限計算，裝備越好回得越快", () => {
    // 取整之後不會剛好是 10 倍（17 對 175），所以分別對各自的期望值斷言
    expect(offlineRegen(0, 200, HOUR)).toBe(Math.floor(200 * OFFLINE_REGEN_PER_HOUR_RATIO));
    expect(offlineRegen(0, 2000, HOUR)).toBe(Math.floor(2000 * OFFLINE_REGEN_PER_HOUR_RATIO));
    expect(offlineRegen(0, 2000, HOUR)).toBeGreaterThan(offlineRegen(0, 200, HOUR));
  });
});

describe("msUntilFullHealth", () => {
  it("落敗保底（30%）出發時剛好是 8 小時", () => {
    const max = 1000;

    const ms = msUntilFullHealth(Math.floor(max * 0.3), max);

    expect(Math.round(ms / HOUR)).toBe(OFFLINE_REGEN_TO_FULL_HOURS);
  });

  it("已經滿血回 0", () => {
    expect(msUntilFullHealth(1000, 1000)).toBe(0);
  });
});
