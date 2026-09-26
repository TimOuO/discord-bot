import { EmbedBuilder, ColorResolvable } from "discord.js";
import { xpThresholdForLevel } from "../../services/rpgService";
import { msUntilFullHealth } from "../../services/combat";
import { formatCooldown } from "../../utils/datetime";
import { ACCESSORY_SLOTS } from "../../services/itemService";
import type { EffectiveStats } from "../../services/itemService";
import { titleText } from "../../services/achievements";
import { effectiveStatsFields } from "./statsFields";
import { jobLabelFor } from "./job";
import { sectionField, chip, progressBar } from "../../utils/embeds";

/**
 * `/rpg profile` 的卡片組成，跟 interaction 完全脫鉤。
 *
 * 抽出來的原因跟 statsFields.ts 一樣：卡片組成一直沒有任何測試覆蓋，地下城的「再戰一次」
 * 按鈕就是在重寫時無聲掉掉的、只靠玩家截圖才發現。把它變成「吃一份資料、吐一個 embed」
 * 的函式之後，預覽腳本（npm run preview:profile）跟測試都拿得到跟正式卡片一模一樣的東西。
 */
export interface ProfileCardInput {
  username: string;
  avatarURL: string | null;
  user: {
    title: string | null;
    job: string | null;
    level: number;
    xp: number;
    gold: number;
    attack: number;
    defense: number;
    maxHealth: number;
    loginStreak: number;
    createdAt: Date;
    lastBattle: Date | null;
    lastDaily: Date | null;
  };
  effectiveStats: EffectiveStats;
  /** 結算過離線回血之後的血量 */
  health: number;
  /** 這次結算補了多少血；0 代表沒有離線回血可講 */
  healedWhileAway: number;
  equipped: {
    slot: string;
    equipped: { enhanceLevel: number; item: { name: string } } | null;
  }[];
}

export function buildProfileEmbed(input: ProfileCardInput): EmbedBuilder {
  const { username, avatarURL, user, effectiveStats, health, healedWhileAway, equipped } = input;

  const gearLine = (slot: string) => {
    const eq = equipped.find((e) => e.slot === slot)?.equipped;
    if (!eq) return "（空）";
    return `${eq.item.name}${eq.enhanceLevel > 0 ? ` +${eq.enhanceLevel}` : ""}`;
  };
  const accessories = ACCESSORY_SLOTS.map((slot) => gearLine(slot));

  const title = titleText(user.title);

  const embed = new EmbedBuilder()
    // 稱號掛在名字前面，跟其他 RPG 的資料卡一樣；沒掛稱號就只有名字
    .setTitle(`${title ? `「${title}」` : ""}${username} 的角色資料`)
    .setColor("#2ecc71" as ColorResolvable)
    .setDescription(healedWhileAway > 0 ? `💤 離線期間回復了 ${healedWhileAway} 點生命。` : null)
    .addFields(
      sectionField("📊", "角色狀態", [
        `職業 ${chip(jobLabelFor(user.job))}`,
        `等級 ${chip(user.level)}（經驗 ${chip(`${user.xp}/${xpThresholdForLevel(user.level)}`)}）`,
        `生命值 ${progressBar(health, effectiveStats.maxHealth)} ${chip(`${health}/${effectiveStats.maxHealth}`)}`,
        // 資訊只在能改變決定時才出現：滿血就不用多講，殘血才需要知道「要不要等一下再打」
        ...(health < effectiveStats.maxHealth
          ? [`約 ${formatCooldown(msUntilFullHealth(health, effectiveStats.maxHealth))}後滿血`]
          : []),
        `金幣 ${chip(user.gold)}`,
        ...(user.loginStreak > 0 ? [`連續簽到 ${chip(`${user.loginStreak} 天`)}`] : []),
      ]),
      ...effectiveStatsFields(user, effectiveStats),
      sectionField("🎒", "裝備", [
        `武器 ${gearLine("weapon")}`,
        `防具 ${gearLine("armor")}`,
        `飾品 ${accessories.join("、")}`,
      ])
    )
    .setFooter({
      text: `戰鬥數值已含裝備、強化與成就加成・創建於 ${user.createdAt.toLocaleDateString()}`,
    });

  if (avatarURL) {
    embed.setAuthor({ name: username, iconURL: avatarURL });
    // 大頭貼放右上角，卡片才不會整片都是文字
    embed.setThumbnail(avatarURL);
  }

  const historyLines: string[] = [];
  if (user.lastBattle) {
    historyLines.push(`上次戰鬥 ${chip(new Date(user.lastBattle).toLocaleString())}`);
  }
  if (user.lastDaily) {
    historyLines.push(`上次簽到 ${chip(new Date(user.lastDaily).toLocaleString())}`);
  }
  if (historyLines.length > 0) {
    embed.addFields(sectionField("🕒", "時間紀錄", historyLines));
  }

  return embed;
}
