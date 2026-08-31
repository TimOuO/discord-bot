import {
  ChatInputCommandInteraction,
  ButtonInteraction,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ColorResolvable,
  MessageFlags,
} from "discord.js";
import { RPGService } from "../../services/rpgService";
import { ItemService, RARITY_LABELS } from "../../services/itemService";
import { buildCustomId, parseCustomId, requireInteractionOwner } from "../../utils/interactions";
import { chip } from "../../utils/embeds";

function buildFishSellRow(ownerId: string, itemName: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId("fish_sell", ownerId, itemName))
      .setLabel("立即賣掉")
      .setEmoji("💰")
      .setStyle(ButtonStyle.Secondary)
  );
}

export async function handleFishCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();

    const result = await RPGService.fish(interaction.user.id);

    if (result.status === "not_started") {
      return interaction.editReply(
        "你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！"
      );
    }
    if (result.status === "cooldown") {
      return interaction.editReply(
        `🎣 魚餌還沒準備好，請等待 ${result.remainingSeconds} 秒後再釣。`
      );
    }
    if (result.status === "empty") {
      return interaction.editReply(`🎣 ${result.message}`);
    }

    const rarityLabel = RARITY_LABELS[result.item.rarity] ?? result.item.rarity;
    const embed = new EmbedBuilder()
      .setAuthor({
        name: interaction.user.username,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .setTitle("🎣 釣魚成功！")
      .setColor("#3498db" as ColorResolvable)
      .setDescription(
        [
          `▷ 釣到了一隻 \`${result.item.name}\`（${rarityLabel}）`,
          `▷ 目前擁有 ${chip(result.quantity)} 隻`,
          `▷ 獲得經驗 ${chip(result.xpGained)} ✨`,
        ].join("\n")
      );

    return interaction.editReply({
      embeds: [embed],
      components: [buildFishSellRow(interaction.user.id, result.item.name)],
    });
  } catch (error) {
    console.error("RPG Fish 命令錯誤:", error);
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`釣魚失敗：${message}`);
  }
}

// interactionCreate.ts 會把 "fish_sell:*" 的按鈕點擊導到這裡；只賣掉剛釣到的這一隻，不是全部
export async function handleFishSellButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;

  const itemName = args[0];

  await interaction.deferUpdate();
  try {
    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) throw new Error("找不到你的角色資料");

    const { sellPrice } = await ItemService.sellItem(user.id, itemName);

    const originalEmbed = interaction.message.embeds[0];
    const embed = originalEmbed
      ? EmbedBuilder.from(originalEmbed)
          .setColor("#95a5a6" as ColorResolvable)
          .addFields({ name: "已賣出", value: `💰 +${sellPrice} 金幣` })
      : new EmbedBuilder().setDescription(`已賣出，獲得 ${sellPrice} 金幣`);

    await interaction.editReply({ embeds: [embed], components: [] });
  } catch (error) {
    // 賣不掉（例如剛好被裝備上、或已經賣完了）不動原本卡片，只用 ephemeral 提示
    const message = error instanceof Error ? error.message : String(error);
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  }
}
