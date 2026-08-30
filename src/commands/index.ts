import {
  SlashCommandBuilder,
  CommandInteraction,
  AutocompleteInteraction,
} from "discord.js";
import fs from "fs";
import path from "path";
import { ExtendedClient } from "../structures/ExtendedClient";

export interface Command {
  data: SlashCommandBuilder | any;
  execute: (interaction: CommandInteraction) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

function isLoadableModule(file: string): boolean {
  if (file.endsWith(".d.ts") || file.endsWith(".map")) return false;
  const ext = path.extname(file);
  if (ext !== ".ts" && ext !== ".js") return false;
  return path.basename(file, ext) !== "index";
}

// 供這個檔案與 deploy-commands.ts 共用：掃描 commands 目錄、載入每個指令模組
export function loadCommandModules(): { file: string; command: Command }[] {
  const commandsPath = path.join(__dirname);
  const commandFiles = fs.readdirSync(commandsPath).filter(isLoadableModule);

  return commandFiles.map((file) => {
    const command = require(path.join(commandsPath, file)).default as Command;
    return { file, command };
  });
}

// 開機時只把指令載入 client.commands 供本地執行對照，不會呼叫 Discord REST API
// 註冊/更新斜線指令請執行 `npm run deploy`（src/deploy-commands.ts）
export function registerCommands(client: ExtendedClient): void {
  for (const { file, command } of loadCommandModules()) {
    if (command && "data" in command && "execute" in command) {
      client.commands.set(command.data.name, command);
    } else {
      console.log(`警告: ${file} 缺少必要的 'data' 或 'execute' 屬性`);
    }
  }

  console.log(
    "已載入的指令:",
    [...client.commands.keys()].join(", ")
  );
}
