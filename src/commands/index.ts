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

// 供這個檔案與 deploy-commands.ts 共用：掃描 commands 目錄、載入每個指令模組。
// 指令可以是單一檔案（foo.ts），也可以是資料夾（foo/index.ts，太大的指令拆多個檔案時用）；
// require() 目錄時 Node 本來就會自動找裡面的 index，不用額外處理
export function loadCommandModules(): { file: string; command: Command }[] {
  const commandsPath = path.join(__dirname);
  const entries = fs.readdirSync(commandsPath, { withFileTypes: true });

  const results: { file: string; command: Command }[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const command = require(path.join(commandsPath, entry.name)).default as Command;
      results.push({ file: `${entry.name}/index`, command });
      continue;
    }
    if (!isLoadableModule(entry.name)) continue;
    const command = require(path.join(commandsPath, entry.name)).default as Command;
    results.push({ file: entry.name, command });
  }
  return results;
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
