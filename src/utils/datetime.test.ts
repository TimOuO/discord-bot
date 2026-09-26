import { describe, it, expect } from "vitest";
import { formatCooldown } from "./datetime";

describe("formatCooldown", () => {
  it("不到一分鐘用秒表示", () => {
    expect(formatCooldown(30_000)).toBe("30 秒");
  });

  it("整分鐘用分鐘表示，比「60 秒」好讀", () => {
    expect(formatCooldown(60_000)).toBe("1 分鐘");
    expect(formatCooldown(5 * 60_000)).toBe("5 分鐘");
  });

  it("不是整分鐘就補上秒數，不要無聲進位騙玩家", () => {
    expect(formatCooldown(90_000)).toBe("1 分 30 秒");
  });
});

describe("formatCooldown 的小時", () => {
  it("滿一小時就用小時表示，不會寫成「60 分鐘」", () => {
    expect(formatCooldown(60 * 60_000)).toBe("1 小時");
  });

  it("不是整小時就補上分鐘", () => {
    expect(formatCooldown((2 * 60 + 30) * 60_000)).toBe("2 小時 30 分");
  });

  it("到小時這個尺度就不列秒數了，但零頭一律往上進位——寧可讓玩家多等也不要白跑一趟", () => {
    // 1 小時 0 分 1 秒 → 進位成 1 小時 1 分，不是抹掉變成「1 小時」
    expect(formatCooldown(60 * 60_000 + 1_000)).toBe("1 小時 1 分");
  });

  it("進位剛好把分鐘推到 60 時要進位成下一個小時", () => {
    // 1 小時 59 分 30 秒 → 2 小時，不是「1 小時 60 分」
    expect(formatCooldown((60 + 59) * 60_000 + 30_000)).toBe("2 小時");
  });

  it("離線回血滿血要 8 小時，那個上限顯示得出來", () => {
    expect(formatCooldown(8 * 60 * 60_000)).toBe("8 小時");
  });

  it("不到一小時的維持原本的分秒寫法，按鈕上的冷卻標籤不受影響", () => {
    expect(formatCooldown(59 * 60_000 + 59_000)).toBe("59 分 59 秒");
  });
});
