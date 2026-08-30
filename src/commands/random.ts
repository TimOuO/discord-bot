import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { randomInt } from "crypto";

interface GuessGame {
  secret: number;
  min: number;
  max: number;
  attempts: number;
}

// 猜數字遊戲的進行中場次，依「頻道」分開——同一個頻道的人一起猜同一個數字，
// 重開機重來也無妨（不是需要保存的資料）
const activeGames = new Map<string, GuessGame>();

export default {
  data: new SlashCommandBuilder()
    .setName("random")
    .setDescription("猜數字遊戲，同頻道的人一起猜同一個數字")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("start")
        .setDescription("在這個頻道開始一場新的猜數字遊戲")
        .addIntegerOption((option) =>
          option.setName("min").setDescription("最小值（預設 0）").setRequired(false)
        )
        .addIntegerOption((option) =>
          option.setName("max").setDescription("最大值（預設 1000）").setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("guess")
        .setDescription("猜一個數字")
        .addIntegerOption((option) =>
          option.setName("number").setDescription("你猜的數字").setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();
    const channelId = interaction.channelId;

    if (subcommand === "start") {
      const min = interaction.options.getInteger("min") ?? 0;
      const max = interaction.options.getInteger("max") ?? 1000;

      if (min >= max) {
        return interaction.reply(`最小值要比最大值小喔（收到 min=${min}, max=${max}）`);
      }

      const hadPreviousGame = activeGames.has(channelId);
      activeGames.set(channelId, {
        secret: randomInt(min, max + 1),
        min,
        max,
        attempts: 0,
      });

      const restartNote = hadPreviousGame
        ? "（原本這個頻道進行中的那場已經重新開始）"
        : "";
      return interaction.reply(
        `🎯 我想好一個 ${min}~${max} 之間的數字了，這個頻道的大家都可以用 \`/random guess\` 一起猜猜看！${restartNote}`
      );
    }

    if (subcommand === "guess") {
      const game = activeGames.get(channelId);
      if (!game) {
        return interaction.reply(
          "這個頻道還沒有進行中的遊戲喔，先用 `/random start` 開一場！"
        );
      }

      const guess = interaction.options.getInteger("number", true);
      game.attempts += 1;

      if (guess === game.secret) {
        activeGames.delete(channelId);
        const reply = await interaction.reply({
          content: `🎉 ${interaction.user} 猜 **${guess}**，猜中了！答案就是 ${game.secret}，這個頻道總共猜了 ${game.attempts} 次！`,
          withResponse: true,
        });
        await reply.resource?.message?.react("✅");
        return;
      }

      if (guess < game.secret) {
        game.min = Math.max(game.min, guess + 1);
        const reply = await interaction.reply({
          content: `📈 ${interaction.user} 猜 **${guess}**，太小了，再猜大一點（第 ${game.attempts} 次，目前範圍 ${game.min}~${game.max}）`,
          withResponse: true,
        });
        await reply.resource?.message?.react("⬆️");
        return;
      }

      game.max = Math.min(game.max, guess - 1);
      const reply = await interaction.reply({
        content: `📉 ${interaction.user} 猜 **${guess}**，太大了，再猜小一點（第 ${game.attempts} 次，目前範圍 ${game.min}~${game.max}）`,
        withResponse: true,
      });
      await reply.resource?.message?.react("⬇️");
    }
  },
};
