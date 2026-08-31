import { ActivityType } from "discord.js";
import { ExtendedClient } from "../structures/ExtendedClient";
import { startDailyVoiceStatusRotation } from "../services/voiceStatusService";
import { startDailyBackup } from "../services/backupService";

export default (client: ExtendedClient): void => {
  client.on("clientReady", () => {
    if (!client.user) return;

    console.log(`已登入為 ${client.user.tag}`);

    client.user.setPresence({
      activities: [
        {
          name: "大胖呱🐷喵喵小肥呱🐷",
          type: ActivityType.Watching,
        },
      ],
      status: "online",
    });

    startDailyVoiceStatusRotation(client.rest);
    startDailyBackup(client);
  });
};
