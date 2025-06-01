// 寫一個 Discord v14 Slash 指令 "play preview" ，參數為 Spotify track url。解析 ID 後用 axios 要求 https://p.scdn.co/mp3-preview/... ，不進語音，只回覆 "Playing preview: <title>". export 須含 data 與 execute。

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import {
  extractSpotifyTrackId,
  getTrackDetails,
} from "../services/spotifyService";

export default {
  data: new SlashCommandBuilder()
    .setName("play-preview")
    .setDescription("播放 Spotify 曲目的預覽")
    .addStringOption((option) =>
      option.setName("url").setDescription("Spotify 曲目連結").setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const spotifyUrl = interaction.options.getString("url", true);
      const trackId = extractSpotifyTrackId(spotifyUrl);

      if (!trackId) {
        return await interaction.editReply(
          "無效的 Spotify 曲目連結，請提供正確的 Spotify 曲目 URL"
        );
      }

      try {
        // 獲取曲目詳情
        const trackDetails = await getTrackDetails(trackId); // 創建嵌入訊息
        const embed = new EmbedBuilder()
          .setColor(0x1db954) // Spotify 綠色
          .setTitle(trackDetails.title)
          .setURL(`https://open.spotify.com/track/${trackId}`);

        // 如果有藝術家資訊，添加到嵌入訊息
        if (trackDetails.artist) {
          embed.setDescription(`藝術家: ${trackDetails.artist}`);
        }

        // 如果有圖片，添加到嵌入訊息
        if (trackDetails.imageUrl) {
          embed.setThumbnail(trackDetails.imageUrl);
        }

        // 準備回覆
        let replyContent = "🎵 Spotify 曲目預覽";

        // 如果有預覽連結，添加到回覆
        if (trackDetails.previewUrl) {
          replyContent += `\n\n**預覽連結:** ${trackDetails.previewUrl}`;
          embed.setFooter({ text: "點擊上方連結可以在 Spotify 播放完整曲目" });
        } else {
          embed.setFooter({
            text: "此曲目無法提供預覽，請在 Spotify 收聽完整曲目",
          });
        }

        // 發送回覆
        await interaction.editReply({
          content: replyContent,
          embeds: [embed],
        });
      } catch (apiError) {
        console.error("Spotify API 錯誤:", apiError);

        // 無法獲取詳細信息時的備用回覆
        await interaction.editReply(
          `播放預覽: https://open.spotify.com/track/${trackId}\n` +
            `(無法獲取詳細信息，請點擊連結在 Spotify 中查看)`
        );
      }
    } catch (error) {
      console.error("播放預覽時發生錯誤:", error);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply("處理 Spotify 預覽時發生錯誤，請稍後再試");
      } else {
        await interaction.reply("處理 Spotify 預覽時發生錯誤，請稍後再試");
      }
    }
  },
};
