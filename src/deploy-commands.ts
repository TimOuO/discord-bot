import { REST, Routes } from "discord.js";
import { config } from "./config";
import { loadCommandModules } from "./commands";

async function getGuildName(rest: REST, guildId: string): Promise<string> {
  try {
    const guild = (await rest.get(Routes.guild(guildId))) as { name: string };
    return guild.name;
  } catch {
    return "未知伺服器";
  }
}

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

  if (config.guildIds.length > 0) {
    // 避免舊的全域註冊跟伺服器專屬指令同時存在、在伺服器裡顯示成重複的兩份
    await rest.put(Routes.applicationCommands(config.clientId), { body: [] });
    console.log("已清空全域指令（避免跟伺服器專屬指令重複顯示）");

    for (const guildId of config.guildIds) {
      await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), {
        body: commands,
      });
      const guildName = await getGuildName(rest, guildId);
      console.log(
        `已註冊到伺服器「${guildName}」(${guildId})（伺服器專屬指令，近乎即時生效）`
      );
    }
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), {
      body: commands,
    });
    console.log("已註冊為全域指令（最多可能要等 1 小時才會顯示出來）");
  }

  console.log("成功註冊斜線指令!");
}

deployCommands().catch((error) => {
  console.error("註冊斜線指令時發生錯誤:", error);
  process.exit(1);
});
