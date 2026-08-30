import { REST, Routes } from "discord.js";
import { config } from "./config";
import { loadCommandModules } from "./commands";

async function deployCommands() {
  const commands: any[] = [];

  for (const { file, command } of loadCommandModules()) {
    if (command && "data" in command && "execute" in command) {
      commands.push(command.data.toJSON());
    } else {
      console.log(`警告: ${file} 缺少必要的 'data' 或 'execute' 屬性`);
    }
  }

  if (!config.clientId) {
    throw new Error("Discord client ID is not defined in config");
  }

  const rest = new REST({ version: "10" }).setToken(config.token);

  console.log(
    `開始刷新 ${commands.length} 個斜線指令:`,
    commands.map((cmd) => cmd.name).join(", ")
  );

  await rest.put(Routes.applicationCommands(config.clientId), {
    body: commands,
  });

  console.log("成功註冊斜線指令!");
}

deployCommands().catch((error) => {
  console.error("註冊斜線指令時發生錯誤:", error);
  process.exit(1);
});
