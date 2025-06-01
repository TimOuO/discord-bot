import { ExtendedClient } from "../structures/ExtendedClient";
import { Interaction, InteractionReplyOptions, MessageFlags } from "discord.js";

export default (client: ExtendedClient): void => {
  client.on("interactionCreate", async (interaction: Interaction) => {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);

      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`執行 ${interaction.commandName} 命令時發生錯誤:`, error);

        try {
          const errorResponse: InteractionReplyOptions = {
            content: "執行此命令時發生錯誤！",
            flags: MessageFlags.Ephemeral,
          };

          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorResponse);
          } else {
            await interaction.reply(errorResponse);
          }
        } catch (followUpError) {
          console.error("回應錯誤消息失敗:", followUpError);
        }
      }
    }
  });
};
