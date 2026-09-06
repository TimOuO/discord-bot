import { ChatInputCommandInteraction, EmbedBuilder, ColorResolvable } from "discord.js";
import { RPGService, xpThresholdForLevel } from "../../services/rpgService";
import { msUntilFullHealth } from "../../services/combat";
import { formatCooldown } from "../../utils/datetime";
import { ItemService, ACCESSORY_SLOTS } from "../../services/itemService";
import { effectiveStatsFields } from "./statsFields";
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
    const effectiveStats = await ItemService.getEffectiveStats(user.id, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });

    const equipped = await ItemService.getEquipped(user.id);

    const gearLine = (slot: string) => {
      const eq = equipped.find((e) => e.slot === slot)?.equipped;
      if (!eq) return "（空）";
      return `${eq.item.name}${eq.enhanceLevel > 0 ? ` +${eq.enhanceLevel}` : ""}`;
    };
    const accessories = ACCESSORY_SLOTS.map((slot) => gearLine(slot));

    const embed = new EmbedBuilder()
      .setAuthor({ name: username, iconURL: interaction.user.displayAvatarURL() })
      .setTitle(`${username} 的角色資料`)
      .setColor("#2ecc71" as ColorResolvable)
      // 大頭貼放右上角，卡片才不會整片都是文字
      .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
      .setDescription(regen.healed > 0 ? `💤 離線期間回復了 ${regen.healed} 點生命。` : null)
      .addFields(
        sectionField("📊", "角色狀態", [
          `等級 ${chip(user.level)}（經驗 ${chip(`${user.xp}/${xpThresholdForLevel(user.level)}`)}）`,
          `生命值 ${progressBar(regen.health, effectiveStats.maxHealth)} ${chip(`${regen.health}/${effectiveStats.maxHealth}`)}`,
          // 資訊只在能改變決定時才出現：滿血就不用多講，殘血才需要知道「要不要等一下再打」
          ...(regen.health < effectiveStats.maxHealth
            ? [`約 ${formatCooldown(msUntilFullHealth(regen.health, effectiveStats.maxHealth))}後滿血`]
            : []),
          `金幣 ${chip(user.gold)}`,
          ...(user.loginStreak > 0 ? [`連續簽到 ${chip(`${user.loginStreak} 天`)}`] : []),
        ]),
        ...effectiveStatsFields(user, effectiveStats),
        sectionField("🎒", "裝備", [
          `武器 ${gearLine("weapon")}`,
          `防具 ${gearLine("armor")}`,
          `飾品 ${accessories.join("、")}`,
        ])
      )
      .setFooter({
        text: `戰鬥數值已含裝備與強化加成・創建於 ${user.createdAt.toLocaleDateString()}`,
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
