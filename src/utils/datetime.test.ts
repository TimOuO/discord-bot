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
