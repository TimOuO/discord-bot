import { describe, it, expect } from "vitest";
import { createNotifyThrottle, formatCrashMessage } from "./crashNotifier";

describe("createNotifyThrottle", () => {
  it("第一則一定送得出去", () => {
    const throttle = createNotifyThrottle(1000, () => 0);
    expect(throttle.tryAcquire()).toEqual({ allowed: true, suppressed: 0 });
  });

  it("間隔內的後續錯誤被壓下來，不會每一則都私訊", () => {
    let now = 0;
    const throttle = createNotifyThrottle(1000, () => now);
    throttle.tryAcquire();
    now = 500;
    expect(throttle.tryAcquire()).toEqual({ allowed: false });
    now = 999;
    expect(throttle.tryAcquire()).toEqual({ allowed: false });
  });

  it("過了間隔再送時，會帶上中間被壓掉幾則，送完計數歸零", () => {
    let now = 0;
    const throttle = createNotifyThrottle(1000, () => now);
    throttle.tryAcquire();
    now = 100;
    throttle.tryAcquire();
    now = 200;
    throttle.tryAcquire();
    now = 1000;
    expect(throttle.tryAcquire()).toEqual({ allowed: true, suppressed: 2 });
    now = 2000;
    expect(throttle.tryAcquire()).toEqual({ allowed: true, suppressed: 0 });
  });
});

describe("formatCrashMessage", () => {
  it("附上 stack trace，真正要查的時候才有線索", () => {
    const error = new Error("connect ECONNREFUSED");
    const message = formatCrashMessage("崩潰", error, 0);
    expect(message).toContain("⚠️ 機器人崩潰");
    expect(message).toContain(error.stack);
    expect(message).not.toContain("另外還有");
  });

  it("有被壓下來的錯誤時會註明數量", () => {
    expect(formatCrashMessage("出錯", new Error("x"), 3)).toContain("另外還有 3 則");
  });

  it("不是 Error 的 rejection 也能顯示", () => {
    expect(formatCrashMessage("出錯", "字串原因", 0)).toContain("字串原因");
  });

  it("超長的 stack 會截斷，不會超過 Discord 的 2000 字上限而整則送不出去", () => {
    const message = formatCrashMessage("出錯", "a".repeat(5000), 99);
    expect(message.length).toBeLessThanOrEqual(2000);
    expect(message).toContain("已截斷");
  });
});
