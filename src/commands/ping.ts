import { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("回覆延遲測試"),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const ping = Date.now() - interaction.createdTimestamp;

      await interaction.editReply(
        `延遲: ${ping}ms\nAPI 延遲: ${Math.round(interaction.client.ws.ping)}ms`
      );
    } catch (error) {
      console.error("Ping 命令執行錯誤:", error);
    }
  },
};
