import { describe, it, expect } from "vitest";
import { buildProfileEmbed, type ProfileCardInput } from "./profileCard";

const BASE: ProfileCardInput = {
  username: "vera",
  avatarURL: "https://example.invalid/avatar.png",
  user: {
    title: null,
    job: "smith",
    level: 85,
    xp: 420,
    gold: 179_000,
    attack: 178,
    defense: 89,
    maxHealth: 940,
    loginStreak: 28,
    createdAt: new Date("2026-08-29"),
    lastBattle: new Date("2026-09-25T21:14:00"),
    lastDaily: new Date("2026-09-26T00:02:00"),
  },
  effectiveStats: {
    attack: 578,
    defense: 314,
    maxHealth: 1_270,
    critRate: 28,
    dodgeRate: 18,
    goldBonus: 0,
    xpBonus: 0,
  },
  health: 1_270,
  healedWhileAway: 0,
  equipped: [
    { slot: "weapon", equipped: { enhanceLevel: 7, item: { name: "混沌戰斧" } } },
    { slot: "armor", equipped: { enhanceLevel: 0, item: { name: "混沌魔甲" } } },
    { slot: "accessory1", equipped: { enhanceLevel: 4, item: { name: "獵殺者之刃" } } },
    { slot: "accessory2", equipped: null },
    { slot: "accessory3", equipped: null },
  ],
};

/** 把所有欄位的內容攤成一個字串，方便斷言「卡片上有沒有這行」 */
function textOf(input: ProfileCardInput): string {
  const data = buildProfileEmbed(input).toJSON();
  return [
    data.title ?? "",
    data.description ?? "",
    ...(data.fields ?? []).flatMap((f) => [f.name, f.value]),
    data.footer?.text ?? "",
  ].join("\n");
}

describe("buildProfileEmbed 的稱號", () => {
  it("沒掛稱號時標題就只有名字", () => {
    expect(buildProfileEmbed(BASE).toJSON().title).toBe("vera 的角色資料");
  });

  it("掛了成就附贈的稱號，會用引號掛在名字前面", () => {
    const embed = buildProfileEmbed({ ...BASE, user: { ...BASE.user, title: "level_60" } });
    expect(embed.toJSON().title).toBe("「百戰老兵」vera 的角色資料");
  });

  it("掛了稱號店買的稱號也一樣顯示", () => {
    const embed = buildProfileEmbed({ ...BASE, user: { ...BASE.user, title: "shop_richest" } });
    expect(embed.toJSON().title).toBe("「本地最有錢的人」vera 的角色資料");
  });

  it("認不出來的稱號 key 當作沒掛，不會把那串 key 印在卡片上", () => {
    // 稱號店改商品之後，玩家身上可能留著已經不存在的 key
    const embed = buildProfileEmbed({
      ...BASE,
      user: { ...BASE.user, title: "shop_this_was_removed" },
    });
    expect(embed.toJSON().title).toBe("vera 的角色資料");
  });

  it("標題就算掛上最長的稱號也還在 Discord 的 256 字上限內", () => {
    const embed = buildProfileEmbed({
      ...BASE,
      username: "a".repeat(32), // Discord 使用者名稱上限
      user: { ...BASE.user, title: "shop_richest" },
    });
    expect((embed.toJSON().title ?? "").length).toBeLessThanOrEqual(256);
  });
});

describe("buildProfileEmbed 的其他欄位", () => {
  it("滿血時不顯示「還要多久滿血」——資訊只在能改變決定時才出現", () => {
    expect(textOf(BASE)).not.toContain("後滿血");
  });

  it("殘血時顯示預計滿血時間，還有離線回了多少", () => {
    const text = textOf({ ...BASE, health: 612, healedWhileAway: 240 });
    expect(text).toContain("後滿血");
    expect(text).toContain("離線期間回復了 240 點生命");
  });

  it("裝備欄空的就寫（空），不是整行消失", () => {
    expect(textOf(BASE)).toContain("（空）");
  });

  it("強化等級 0 的裝備不顯示 +0", () => {
    const text = textOf(BASE);
    expect(text).toContain("混沌魔甲");
    expect(text).not.toContain("混沌魔甲 +0");
  });

  it("加成那一欄不再叫「裝備加成」——那四個數字現在含成就給的部分", () => {
    const names = (buildProfileEmbed(BASE).toJSON().fields ?? []).map((f) => f.name);
    expect(names.some((n) => n.includes("裝備加成"))).toBe(false);
    expect(names.some((n) => n.includes("額外加成"))).toBe(true);
  });

  it("沒有大頭貼網址時不會塞空的 author/thumbnail（預覽腳本會這樣叫）", () => {
    const data = buildProfileEmbed({ ...BASE, avatarURL: null }).toJSON();
    expect(data.author).toBeUndefined();
    expect(data.thumbnail).toBeUndefined();
  });
});
