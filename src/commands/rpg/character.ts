import { ChatInputCommandInteraction, EmbedBuilder, ColorResolvable } from "discord.js";
import { RPGService, xpThresholdForLevel } from "../../services/rpgService";
import { ItemService } from "../../services/itemService";
import { notifyUnlockedAchievements } from "./achievements";
import { AchievementService } from "../../services/achievementService";
import { buildProfileEmbed } from "./profileCard";
import { sectionField, chip, progressBar } from "../../utils/embeds";

export async function handleStartCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();

    const userId = interaction.user.id;
    const username = interaction.user.username;

    const existingUser = await RPGService.findUserByDiscordId(userId);
    if (existingUser) {
      return interaction.editReply(
        `你已經開始過冒險了，${username}！目前是 Lv.${existingUser.level}。用 \`/rpg profile\` 查看完整角色資料。`
      );
    }

    const user = await RPGService.startRPG(userId, username);
    const effectiveStats = await ItemService.getEffectiveStats(user.id, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });

    const embed = new EmbedBuilder()
      .setTitle("🎮 RPG 冒險開始！")
      .setDescription(`歡迎來到這個充滿奇幻的世界，${username}！`)
      .setColor("#3498db" as ColorResolvable)
      .addFields(
        sectionField("📊", "初始屬性", [
          `等級 ${chip(user.level)}（經驗 ${chip(`${user.xp}/${xpThresholdForLevel(user.level)}`)}）`,
          `生命值 ${progressBar(user.health, user.maxHealth)} ${chip(`${user.health}/${user.maxHealth}`)}`,
          `金幣 ${chip(user.gold)}`,
          `攻擊力 ${chip(effectiveStats.attack)}`,
          `防禦力 ${chip(effectiveStats.defense)}`,
        ]),
        sectionField("🎒", "新手背包", [
          "木劍（已裝備，攻擊力 +5）",
          "皮革護甲（已裝備，防禦力 +3）",
          "小型生命藥水 x3（用 /rpg use 回血）",
        ])
      )
      .setFooter({ text: "使用 /rpg battle 開始戰鬥，/rpg daily 領取每日獎勵" });

    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("RPG Start 命令錯誤:", error);
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`RPG 遊戲開始失敗: ${message}`);
  }
}

export async function handleProfileCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();

    const userId = interaction.user.id;
    const username = interaction.user.username;

    // 獲取或創建用戶
    const user = await RPGService.getOrCreateUser(userId, username);
    // 先結算離線回血再顯示，不然玩家看到的是還沒補上的舊血量
    const regen = await RPGService.applyOfflineRegen(user.id);
    // 成就是懶惰偵測的：在算有效屬性**之前**補記錄，這張卡片顯示的數值才會含這次新解鎖的加成。
    // 通知要等卡片送出去之後才發（followUp 得在 editReply 後面），所以這裡只拿 key
    const unlockedAchievements = await AchievementService.sync(user.id);
    const effectiveStats = await ItemService.getEffectiveStats(user.id, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });

    const equipped = await ItemService.getEquipped(user.id);

    const embed = buildProfileEmbed({
      username,
      avatarURL: interaction.user.displayAvatarURL({ size: 256 }),
      user,
      effectiveStats,
      health: regen.health,
      healedWhileAway: regen.healed,
      equipped,
    });

    await interaction.editReply({ embeds: [embed] });
    return notifyUnlockedAchievements(interaction, unlockedAchievements);
  } catch (error) {
    console.error("RPG Profile 命令錯誤:", error);
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`獲取角色資料失敗: ${message}`);
  }
}
