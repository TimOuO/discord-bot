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

// 按鈕上直接標金額，不用點下去才知道賣了多少錢（跟 fish/shop sell 同樣的道理）
function buildGatherSellRow(
  ownerId: string,
  itemName: string,
  unitPrice: number,
  quantity: number
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId("gather_sell", ownerId, itemName))
      .setLabel(`立即賣掉（${unitPrice} 金幣）`)
      .setEmoji("💰")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildCustomId("gather_sell_all", ownerId, itemName))
      .setLabel(`全部賣掉（${quantity} 個・${unitPrice * quantity} 金幣）`)
      .setEmoji("💰")
      .setStyle(ButtonStyle.Secondary)
  );
}

export async function handleGatherCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();

    const result = await RPGService.gather(interaction.user.id);

    if (result.status === "not_started") {
      return interaction.editReply(
        "你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！"
      );
    }
    if (result.status === "cooldown") {
      return interaction.editReply(
        `⛏️ 還在恢復體力，請等待 ${result.remainingSeconds} 秒後再採集。`
      );
    }
    if (result.status === "empty") {
      return interaction.editReply(`⛏️ ${result.message}`);
    }

    const rarityLabel = RARITY_LABELS[result.item.rarity] ?? result.item.rarity;
    const embed = new EmbedBuilder()
      .setAuthor({
        name: interaction.user.username,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .setTitle("⛏️ 採集成功！")
      .setColor("#8d6e63" as ColorResolvable)
      .setDescription(
        [
          `▷ 採到了一份 \`${result.item.name}\`（${rarityLabel}）`,
          `▷ 目前擁有 ${chip(result.quantity)} 個`,
          `▷ 獲得經驗 ${chip(result.xpGained)} ✨`,
        ].join("\n")
      );

    const unitPrice = ItemService.getSellPricePerUnit(result.item);
    return interaction.editReply({
      embeds: [embed],
      components: [buildGatherSellRow(interaction.user.id, result.item.name, unitPrice, result.quantity)],
    });
  } catch (error) {
    console.error("RPG Gather 命令錯誤:", error);
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`採集失敗：${message}`);
  }
}

// gather_sell、gather_sell_all 兩顆按鈕共用：賣完後把卡片改成灰色、附加「已賣出」欄位，失敗不動原本卡片
async function handleGatherSellInteraction(
  interaction: ButtonInteraction,
  sell: (
    userInternalId: string,
    itemName: string
  ) => Promise<{ sellPrice: number; amount?: number; goldAfter: number }>
) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;

  const itemName = args[0];

  await interaction.deferUpdate();
  try {
    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) throw new Error("找不到你的角色資料");

    const { sellPrice, amount, goldAfter } = await sell(user.id, itemName);
    const soldLabel =
      (amount && amount > 1 ? `x${amount}，+${sellPrice} 金幣` : `+${sellPrice} 金幣`) +
      `（目前 ${goldAfter} 金幣）`;

    const originalEmbed = interaction.message.embeds[0];
    const embed = originalEmbed
      ? EmbedBuilder.from(originalEmbed)
          .setColor("#95a5a6" as ColorResolvable)
          .addFields({ name: "已賣出", value: `💰 ${soldLabel}` })
      : new EmbedBuilder().setDescription(`已賣出 ${soldLabel}`);

    await interaction.editReply({ embeds: [embed], components: [] });
  } catch (error) {
    // 賣不掉（例如已經賣完了）不動原本卡片，只用 ephemeral 提示
    const message = error instanceof Error ? error.message : String(error);
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  }
}

// interactionCreate.ts 會把 "gather_sell:*" 的按鈕點擊導到這裡；只賣掉剛採到的這一份，不是全部
export async function handleGatherSellButton(interaction: ButtonInteraction) {
  await handleGatherSellInteraction(interaction, (userId, itemName) =>
    ItemService.sellItem(userId, itemName)
  );
}

// interactionCreate.ts 會把 "gather_sell_all:*" 的按鈕點擊導到這裡；賣掉背包裡這個材料的全部庫存
export async function handleGatherSellAllButton(interaction: ButtonInteraction) {
  await handleGatherSellInteraction(interaction, (userId, itemName) =>
    ItemService.sellAllOfItem(userId, itemName)
  );
}
