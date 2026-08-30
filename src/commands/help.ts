import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ColorResolvable,
  MessageFlags,
  ApplicationCommandOptionType,
  PermissionFlagsBits,
} from "discord.js";
import { ExtendedClient } from "../structures/ExtendedClient";

interface CommandOptionJSON {
  type: ApplicationCommandOptionType;
  name: string;
  description: string;
  options?: CommandOptionJSON[];
}

interface CommandJSON {
  name: string;
  description: string;
  default_member_permissions?: string | null;
  options?: CommandOptionJSON[];
}

// 把指令定義（可能有子指令、子指令群組）攤平成一行一個可執行的完整指令
function describeCommand(json: CommandJSON): string[] {
  const options = json.options ?? [];
  const hasSubLevel = options.some(
    (option) =>
      option.type === ApplicationCommandOptionType.Subcommand ||
      option.type === ApplicationCommandOptionType.SubcommandGroup
  );

  if (!hasSubLevel) {
    return [`\`/${json.name}\` — ${json.description}`];
  }

  const lines: string[] = [];
  for (const option of options) {
    if (option.type === ApplicationCommandOptionType.Subcommand) {
      lines.push(`\`/${json.name} ${option.name}\` — ${option.description}`);
    } else if (option.type === ApplicationCommandOptionType.SubcommandGroup) {
      for (const sub of option.options ?? []) {
        lines.push(
          `\`/${json.name} ${option.name} ${sub.name}\` — ${sub.description}`
        );
      }
    }
  }
  return lines;
}

export default {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("查看所有可用指令"),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const client = interaction.client as ExtendedClient;
    const isAdmin =
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;

    const commands = [...client.commands.values()]
      .filter((command) => command.data.name !== "help")
      .sort((a, b) => a.data.name.localeCompare(b.data.name));

    const embed = new EmbedBuilder()
      .setTitle("📖 指令說明")
      .setColor("#3498db" as ColorResolvable);

    for (const command of commands) {
      const json = command.data.toJSON() as CommandJSON;

      // 需要管理員權限的指令，對非管理員隱藏
      if (json.default_member_permissions != null && !isAdmin) continue;

      embed.addFields({
        name: `/${json.name}`,
        value: describeCommand(json).join("\n"),
      });
    }

    return interaction.editReply({ embeds: [embed] });
  },
};
