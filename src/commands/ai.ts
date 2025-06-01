import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { generateResponse } from "../services/gemini";

export default {
  data: new SlashCommandBuilder()
    .setName("ai")
    .setDescription("透過 Google Gemini 獲取 AI 回應")
    .addStringOption((option) =>
      option
        .setName("prompt")
        .setDescription("你想問 AI 的問題或提示")
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      const prompt = interaction.options.getString("prompt", true);

      await interaction.deferReply();

      const response = await generateResponse(prompt);

      if (response.length > 1990) {
        await interaction.editReply(response.substring(0, 1990) + "...");
        for (let i = 1990; i < response.length; i += 2000) {
          await interaction.followUp({
            content: response.substring(i, Math.min(i + 2000, response.length)),
            flags: MessageFlags.SuppressNotifications,
          });
        }
      } else {
        await interaction.editReply(response);
      }
    } catch (error) {
      console.error("AI 指令錯誤:", error);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply("產生回應時發生錯誤，請稍後再試。");
      } else {
        await interaction.reply({
          content: "產生回應時發生錯誤，請稍後再試。",
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};
