import { ChatInputCommandInteraction, EmbedBuilder, ColorResolvable } from "discord.js";
import { RPGService, xpThresholdForLevel } from "../../services/rpgService";
import { ItemService } from "../../services/itemService";
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
    const effectiveStats = await ItemService.getEffectiveStats(user.id, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });

    const embed = new EmbedBuilder()
      .setAuthor({ name: username, iconURL: interaction.user.displayAvatarURL() })
      .setTitle(`${username} 的角色資料`)
      .setColor("#2ecc71" as ColorResolvable)
      .addFields(
        sectionField("📊", "角色狀態", [
          `等級 ${chip(user.level)}（經驗 ${chip(`${user.xp}/${xpThresholdForLevel(user.level)}`)}）`,
          `生命值 ${progressBar(user.health, effectiveStats.maxHealth)} ${chip(`${user.health}/${effectiveStats.maxHealth}`)}`,
          `金幣 ${chip(user.gold)}`,
          `攻擊力 ${chip(effectiveStats.attack)}`,
          `防禦力 ${chip(effectiveStats.defense)}`,
        ])
      )
      .setFooter({
        text: `裝備加成已計入；用 /rpg inventory 查看細節・創建時間: ${user.createdAt.toLocaleDateString()}`,
      });

    const historyLines: string[] = [];
    if (user.lastBattle) {
      historyLines.push(`上次戰鬥 ${chip(new Date(user.lastBattle).toLocaleString())}`);
    }
    if (user.lastDaily) {
      historyLines.push(`上次簽到 ${chip(new Date(user.lastDaily).toLocaleString())}`);
    }
    if (historyLines.length > 0) {
      embed.addFields(sectionField("🕒", "時間紀錄", historyLines));
    }

    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("RPG Profile 命令錯誤:", error);
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`獲取角色資料失敗: ${message}`);
  }
}
