import {
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  CommandInteraction,
  MessageFlags,
} from "discord.js";
import fs from "fs";
import path from "path";
import { config } from "../config";
import { ExtendedClient } from "../structures/ExtendedClient";

export interface Command {
  data: SlashCommandBuilder | any;
  execute: (interaction: CommandInteraction) => Promise<void>;
}

export async function registerCommands(client: ExtendedClient): Promise<void> {
  const commands: any[] = [];
  const commandsPath = path.join(__dirname);

  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter(
      (file) =>
        file !== "index.ts" && (file.endsWith(".ts") || file.endsWith(".js"))
    );

  console.log("在目錄中找到的命令檔案:", commandFiles);

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath).default;

    console.log(
      `載入命令檔案: ${file}, 指令名稱: ${command?.data?.name || "未知"}`
    );

    if ("data" in command && "execute" in command) {
      client.commands.set(command.data.name, command);
      commands.push(command.data.toJSON());
    } else {
      console.log(`警告: ${file} 缺少必要的 'data' 或 'execute' 屬性`);
    }
  }

  console.log(
    "即將部署的指令列表:",
    commands.map((cmd) => cmd.name).join(", ")
  );

  const rest = new REST({ version: "10" }).setToken(config.token);

  try {
    console.log(`開始刷新 ${commands.length} 個斜線指令...`);

    if (!config.clientId) {
      throw new Error("Discord client ID is not defined in config");
    }

    await rest.put(Routes.applicationCommands(config.clientId), {
      body: commands,
    });

    console.log("成功註冊斜線指令!");
  } catch (error) {
    console.error("註冊斜線指令時發生錯誤:", error);
  }
}

export function setupCommandHandler(client: ExtendedClient): void {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error("命令執行發生錯誤:", error);

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: "執行此指令時發生錯誤!",
            flags: MessageFlags.Ephemeral,
          });
        } else {
          await interaction.reply({
            content: "執行此指令時發生錯誤!",
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch (followUpError) {
        console.error("回應錯誤消息失敗:", followUpError);
      }
    }
  });
}
