import { ChatInputCommandInteraction, EmbedBuilder, ColorResolvable } from "discord.js";
import { RPGService, DailyClaimResult } from "../../services/rpgService";
import { chip, progressBar } from "../../utils/embeds";

// 共用：/rpg daily 手動簽到、voiceStateUpdate.ts 的自動簽到都用這個組出一樣的 embed
export function buildDailyRewardEmbed(
  username: string,
  result: Extract<DailyClaimResult, { status: "claimed" }>
): EmbedBuilder {
  const { goldReward, streakBonus, streakBonusPercent, finalGoldReward, xpReward, streak, updatedUser, effectiveMaxHealth } =
    result;

  const embed = new EmbedBuilder()
    .setTitle("🎁 每日獎勵")
    .setColor("#f1c40f" as ColorResolvable)
    .setDescription(
      [
        `${username}，你已成功領取今日獎勵！`,
        "",
        // 連續獎勵一併標出百分比，玩家才知道數字怎麼來的、以及連下去還會再加多少
        streakBonus > 0
          ? `▷ 獲得金幣 ${chip(goldReward)} + ${chip(streakBonus)}（連續 ${streak} 天 +${streakBonusPercent}%）= ${chip(finalGoldReward)} 💰`
          : `▷ 獲得金幣 ${chip(finalGoldReward)} 💰`,
        `▷ 獲得經驗 ${chip(xpReward)} ✨`,
        `▷ 生命值恢復 ${progressBar(updatedUser.health, effectiveMaxHealth)} ${chip(`${updatedUser.health}/${effectiveMaxHealth}`)}`,
      ].join("\n")
    );

  if (streak >= 30) {
    embed.setFooter({ text: `🔥 連續登入: ${streak} 天 - 傳奇級玩家！` });
  } else if (streak >= 15) {
    embed.setFooter({ text: `🔥 連續登入: ${streak} 天 - 專業玩家！` });
  } else if (streak >= 7) {
    embed.setFooter({ text: `🔥 連續登入: ${streak} 天 - 忠實玩家！` });
  } else if (streak >= 3) {
    embed.setFooter({ text: `🔥 連續登入: ${streak} 天 - 認真玩家！` });
  } else {
    embed.setFooter({ text: `連續登入: ${streak} 天` });
  }

  embed.setTimestamp();
  return embed;
}

export async function handleDailyCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();

    const result = await RPGService.claimDaily(interaction.user.id);

    if (result.status === "not_started") {
      return interaction.editReply(
        "你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！"
      );
    }

    if (result.status === "already_claimed") {
      return interaction.editReply(
        `⏰ 你今天已經領取過獎勵了！下次領取時間：**${result.remainingHours}小時${result.remainingMinutes}分鐘**後（明天00:00）。`
      );
    }

    const embed = buildDailyRewardEmbed(interaction.user.username, result);
    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Daily command error:", error);
    return interaction.editReply("領取每日獎勵時發生錯誤，請稍後再試。");
  }
}
