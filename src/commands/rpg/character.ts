import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  ColorResolvable,
  MessageFlags,
} from "discord.js";
import { RPGService, xpThresholdForLevel } from "../../services/rpgService";
import { ItemService, TYPE_LABELS, TYPE_EMOJIS, SLOT_LABELS } from "../../services/itemService";
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

    const embed = new EmbedBuilder()
      .setTitle("🎮 RPG 冒險開始！")
      .setDescription(`歡迎來到這個充滿奇幻的世界，${username}！`)
      .setColor("#3498db" as ColorResolvable)
      .addFields(
        sectionField("📊", "初始屬性", [
          `等級 ${chip(user.level)}（經驗 ${chip(`${user.xp}/${xpThresholdForLevel(user.level)}`)}）`,
          `生命值 ${progressBar(user.health, user.maxHealth)} ${chip(`${user.health}/${user.maxHealth}`)}`,
          `金幣 ${chip(user.gold)}`,
          `攻擊力 ${chip(user.attack)}`,
          `防禦力 ${chip(user.defense)}`,
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

export async function handleInventoryCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) {
      return interaction.editReply(
        "你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！"
      );
    }

    const [inventory, equipped, effectiveStats] = await Promise.all([
      ItemService.getInventory(user.id),
      ItemService.getEquipped(user.id),
      ItemService.getEffectiveStats(user.id, {
        attack: user.attack,
        defense: user.defense,
        maxHealth: user.maxHealth,
      }),
    ]);

    const equippedItemIds = new Set(
      equipped.filter((e) => e.equipped).map((e) => e.equipped!.itemId)
    );

    const embed = new EmbedBuilder()
      .setAuthor({
        name: interaction.user.username,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .setTitle(`${interaction.user.username} 的背包`)
      .setColor("#9b59b6" as ColorResolvable)
      .addFields(
        sectionField("📊", "有效屬性（基礎 + 裝備加成）", [
          `攻擊力 ${chip(effectiveStats.attack)}（基礎 ${chip(user.attack)}）`,
          `防禦力 ${chip(effectiveStats.defense)}（基礎 ${chip(user.defense)}）`,
          `生命上限 ${chip(effectiveStats.maxHealth)}（基礎 ${chip(user.maxHealth)}）`,
        ]),
        sectionField(
          "🎒",
          "裝備欄",
          equipped.map(({ slot, equipped: eq }) =>
            eq ? `${SLOT_LABELS[slot]}：${eq.item.name}` : `${SLOT_LABELS[slot]}：（空）`
          )
        )
      );

    if (inventory.length === 0) {
      embed.addFields(
        sectionField("🧳", "道具", ["背包是空的，去 `/rpg shop list` 逛逛吧！"])
      );
    } else {
      for (const type of Object.keys(TYPE_LABELS)) {
        const itemsOfType = inventory.filter((row) => row.item.type === type);
        if (itemsOfType.length === 0) continue;

        const lines = itemsOfType.map((row) => {
          const equippedTag = equippedItemIds.has(row.itemId) ? "（裝備中）" : "";
          return `${row.item.name} x${chip(row.quantity)}${equippedTag}`;
        });
        embed.addFields(sectionField(TYPE_EMOJIS[type] ?? "🧳", TYPE_LABELS[type], lines));
      }
    }

    embed.setFooter({ text: "使用 /rpg equip 裝備道具、/rpg use 使用藥水" });

    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("RPG Inventory 命令錯誤:", error);
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`查看背包失敗：${message}`);
  }
}
