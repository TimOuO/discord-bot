import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActivityType,
  MessageFlags,
} from "discord.js";
import type { CommandInteraction, PresenceStatusData } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("更改機器人的狀態")
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("狀態類型")
        .setRequired(true)
        .addChoices(
          { name: "遊玩中", value: "PLAYING" },
          { name: "直播中", value: "STREAMING" },
          { name: "聆聽中", value: "LISTENING" },
          { name: "觀看中", value: "WATCHING" },
          { name: "競爭中", value: "COMPETING" }
        )
    )
    .addStringOption((option) =>
      option.setName("content").setDescription("狀態內容").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("status")
        .setDescription("上線狀態")
        .setRequired(false)
        .addChoices(
          { name: "在線", value: "online" },
          { name: "閒置", value: "idle" },
          { name: "請勿打擾", value: "dnd" },
          { name: "隱形", value: "invisible" }
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: CommandInteraction) {
    const type = interaction.options.get("type")?.value as string;
    const content = interaction.options.get("content")?.value as string;
    const status = ((interaction.options.get("status")?.value as string) ||
      "online") as PresenceStatusData;

    let activityType: ActivityType;

    switch (type) {
      case "PLAYING":
        activityType = ActivityType.Playing;
        break;
      case "STREAMING":
        activityType = ActivityType.Streaming;
        break;
      case "LISTENING":
        activityType = ActivityType.Listening;
        break;
      case "WATCHING":
        activityType = ActivityType.Watching;
        break;
      case "COMPETING":
        activityType = ActivityType.Competing;
        break;
      default:
        activityType = ActivityType.Playing;
    }

    try {
      interaction.client.user.setPresence({
        activities: [
          {
            name: content,
            type: activityType,
          },
        ],
        status: status,
      });

      await interaction.reply({
        content: `狀態已更新為：${type} ${content}，上線狀態：${status}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error("更新狀態時發生錯誤:", error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: "更新狀態時發生錯誤！",
            flags: MessageFlags.Ephemeral,
          })
          .catch(console.error);
      }
    }
  },
};
