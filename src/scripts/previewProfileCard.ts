/**
 * 把 /rpg profile 的卡片印成文字，用來在推上正式環境之前確認排版。
 *
 * 用的是 profileCard.ts 裡**正式那一個** buildProfileEmbed，不是另外抄一份版面——
 * 抄一份的預覽會騙人，改了卡片而忘了改預覽的話它還是會印出漂亮的舊版。
 *
 * 執行：npm run preview:profile
 */
import { EmbedBuilder } from "discord.js";
import { buildProfileEmbed, type ProfileCardInput } from "../commands/rpg/profileCard";
import { titleText } from "../services/achievements";

/** Discord embed 大致長什麼樣：標題、描述、欄位（inline 的兩兩並排） */
function render(embed: EmbedBuilder): string {
  const data = embed.toJSON();
  const out: string[] = [];
  const WIDTH = 72;

  out.push("┌" + "─".repeat(WIDTH) + "┐");
  const push = (text: string) => out.push("│ " + text);

  if (data.author) push(`🖼  ${data.author.name}`);
  if (data.title) push(`【 ${data.title} 】`);
  if (data.description) push(data.description);
  push("");

  const fields = data.fields ?? [];
  let i = 0;
  while (i < fields.length) {
    const field = fields[i];
    // Discord 把連續的 inline 欄位排成同一列（一列最多三欄），這裡簡化成左右兩欄
    const inlineRun: typeof fields = [];
    while (i < fields.length && fields[i].inline) {
      inlineRun.push(fields[i]);
      i += 1;
    }
    if (inlineRun.length > 0) {
      const columns = inlineRun.map((f) => [f.name, ...f.value.split("\n")]);
      const height = Math.max(...columns.map((c) => c.length));
      const colWidth = Math.floor((WIDTH - 4) / columns.length);
      for (let row = 0; row < height; row++) {
        push(columns.map((c) => (c[row] ?? "").padEnd(colWidth)).join(" "));
      }
      push("");
      continue;
    }
    push(field.name);
    for (const line of field.value.split("\n")) push(line);
    push("");
    i += 1;
  }

  if (data.footer) push(`— ${data.footer.text}`);
  out.push("└" + "─".repeat(WIDTH) + "┘");
  return out.join("\n");
}

/** 正式環境的實際數值：vera Lv85（星火匠神、全神話裝、最高強化 +7） */
const BASE: ProfileCardInput = {
  username: "vera",
  avatarURL: null, // 預覽印不出圖片，省掉那一行
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
    // 攻 178 + 一整套神話裝 + 成就（攻 22 / 血 30 / 爆擊 8 / 閃避 2）
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
    { slot: "armor", equipped: { enhanceLevel: 5, item: { name: "混沌魔甲" } } },
    { slot: "accessory1", equipped: { enhanceLevel: 4, item: { name: "獵殺者之刃" } } },
    { slot: "accessory2", equipped: { enhanceLevel: 3, item: { name: "永恆之心" } } },
    { slot: "accessory3", equipped: null },
  ],
};

const CASES: { label: string; title: string | null }[] = [
  { label: "沒掛稱號（現況，部署後第一次打開就是這樣）", title: null },
  { label: "掛成就附贈的稱號", title: "level_60" },
  { label: "掛稱號店買的稱號", title: "shop_gold_slave" },
  { label: "掛最長的那個稱號，看會不會撐爆標題", title: "shop_richest" },
];

for (const { label, title } of CASES) {
  console.log(`\n### ${label}${title ? `：「${titleText(title)}」` : ""}\n`);
  console.log(render(buildProfileEmbed({ ...BASE, user: { ...BASE.user, title } })));
}

// 殘血 + 離線回血的版本，確認多出來的那兩行不會把稱號那一行擠掉
console.log("\n### 殘血 + 離線回血 + 掛稱號（最擁擠的情況）\n");
console.log(
  render(
    buildProfileEmbed({
      ...BASE,
      user: { ...BASE.user, title: "enhance_8" },
      health: 612,
      healedWhileAway: 240,
    })
  )
);
