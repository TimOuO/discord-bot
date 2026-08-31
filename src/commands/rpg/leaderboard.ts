import { ChatInputCommandInteraction, EmbedBuilder, ColorResolvable } from "discord.js";
import { RPGService, xpThresholdForLevel } from "../../services/rpgService";
import { chip } from "../../utils/embeds";

const RANK_EMOJIS = ["🥇", "🥈", "🥉"];

export async function handleLeaderboardCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();

    const users = await RPGService.getLeaderboard();

    if (users.length === 0) {
      return interaction.editReply("還沒有人開始冒險，用 `/rpg start` 當第一個吧！");
    }

    const lines = users.map((user, index) => {
      const rankLabel = RANK_EMOJIS[index] ?? `${index + 1}.`;
      return `${rankLabel} **${user.username}** — 等級 ${chip(user.level)}（經驗 ${chip(`${user.xp}/${xpThresholdForLevel(user.level)}`)}・金幣 ${chip(user.gold)}）`;
    });

    const embed = new EmbedBuilder()
      .setTitle("🏆 排行榜")
      .setColor("#f1c40f" as ColorResolvable)
      .setDescription(lines.join("\n"));

    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("RPG Leaderboard 命令錯誤:", error);
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`查看排行榜失敗：${message}`);
  }
}
