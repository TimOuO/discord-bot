import { VoiceState } from "discord.js";
import { config } from "../config";
import { RPGService } from "../services/rpgService";
import { buildDailyRewardEmbed } from "../commands/rpg";
import { ExtendedClient } from "../structures/ExtendedClient";

export default (client: ExtendedClient): void => {
  client.on("voiceStateUpdate", async (oldState: VoiceState, newState: VoiceState) => {
    if (!newState.channelId) return; // 離開語音，不是加入
    if (oldState.channelId === newState.channelId) return; // 頻道沒變（例如只是靜音切換）

    const member = newState.member;
    if (!member || member.user.bot) return;

    const announceChannelId = config.dailyAnnounceChannelsByGuild.get(newState.guild.id);
    if (!announceChannelId) return; // 這個伺服器沒設定公告頻道，功能不生效

    try {
      const result = await RPGService.claimDaily(member.id);
      if (result.status !== "claimed") return; // 還沒 /rpg start 過，或今天已經領過了，安靜略過

      const channel = await client.channels.fetch(announceChannelId).catch(() => null);
      if (!channel || !channel.isSendable()) return;

      const embed = buildDailyRewardEmbed(member.user.username, result);
      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error("自動簽到時發生錯誤:", error);
    }
  });
};
