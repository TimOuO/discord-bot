import { ActivityType } from "discord.js";
import { ExtendedClient } from "../structures/ExtendedClient";

export default (client: ExtendedClient): void => {
  client.on("ready", () => {
    if (!client.user) return;

    console.log(`已登入為 ${client.user.tag}`);

    client.user.setPresence({
      activities: [
        {
          name: "阿拉呱胖哇啦啦阿拉呱花🐷",
          type: ActivityType.Watching,
        },
      ],
      status: "online",
    });
  });
};
