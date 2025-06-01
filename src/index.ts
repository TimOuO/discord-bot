import { GatewayIntentBits } from "discord.js";
import { config } from "./config";
import { registerEvents } from "./events";
import { registerCommands } from "./commands";
import { ExtendedClient } from "./structures/ExtendedClient";

async function main() {
  // 創建擴展的 Discord 客戶端
  const client = new ExtendedClient({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });
  try {
    registerEvents(client);
    await registerCommands(client);

    await client.login(config.token);
  } catch (error) {
    console.error("啟動機器人時發生錯誤:", error);
    process.exit(1);
  }
}

main();
