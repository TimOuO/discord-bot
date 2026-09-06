import { describe, it, expect } from "vitest";
import { PlayerNotice, isPlayerNotice } from "./errors";

describe("PlayerNotice", () => {
  it("認得出自己", () => {
    expect(isPlayerNotice(new PlayerNotice("還要等 30 秒"))).toBe(true);
  });

  it("一般的 Error 不算玩家提示——那種才是真的要有人來看的", () => {
    expect(isPlayerNotice(new Error("connect ECONNREFUSED"))).toBe(false);
    expect(isPlayerNotice(new TypeError("undefined is not a function"))).toBe(false);
  });

  it("完全不是 Error 的東西也不算", () => {
    expect(isPlayerNotice("字串")).toBe(false);
    expect(isPlayerNotice(null)).toBe(false);
    expect(isPlayerNotice(undefined)).toBe(false);
  });

  it("訊息原封不動保留，因為那就是要顯示給玩家看的內容", () => {
    expect(new PlayerNotice("🎣 魚餌還沒準備好").message).toBe("🎣 魚餌還沒準備好");
  });
});
