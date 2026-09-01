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

function buildFishRetryButton(ownerId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildCustomId("fish_retry", ownerId))
    .setLabel("再釣一次")
    .setEmoji("🎣")
    .setStyle(ButtonStyle.Primary);
}

// 「再釣一次」放最前面、按鈕上直接標賣出金額，不用點下去才知道賣了多少錢（跟 shop sell 的「全部賣掉」按鈕同樣的道理）
function buildFishActionRow(
  ownerId: string,
  itemName: string,
  unitPrice: number,
  quantity: number
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    buildFishRetryButton(ownerId),
    new ButtonBuilder()
      .setCustomId(buildCustomId("fish_sell", ownerId, itemName))
      .setLabel(`立即賣掉（${unitPrice} 金幣）`)
      .setEmoji("💰")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildCustomId("fish_sell_all", ownerId, itemName))
      .setLabel(`全部賣掉（${quantity} 隻・${unitPrice * quantity} 金幣）`)
      .setEmoji("💰")
      .setStyle(ButtonStyle.Secondary)
  );
}

// /rpg fish 首次執行、跟「再釣一次」按鈕都呼叫這個，確保卡片長得一模一樣；
// not_started/cooldown 用丟錯誤的方式處理，讓呼叫端統一用 try/catch 決定要怎麼回覆
async function runFishAndBuildReply(userId: string, username: string, avatarURL: string) {
  const result = await RPGService.fish(userId);

  if (result.status === "not_started") {
    throw new Error("你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！");
  }
  if (result.status === "cooldown") {
    throw new Error(`🎣 魚餌還沒準備好，請等待 ${result.remainingSeconds} 秒後再釣。`);
  }
  if (result.status === "empty") {
    const embed = new EmbedBuilder()
      .setAuthor({ name: username, iconURL: avatarURL })
      .setTitle("🎣 空軍")
      .setColor("#95a5a6" as ColorResolvable)
      .setDescription(result.message);
    return {
      embeds: [embed],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(buildFishRetryButton(userId))],
    };
  }

  const rarityLabel = RARITY_LABELS[result.item.rarity] ?? result.item.rarity;
  const embed = new EmbedBuilder()
    .setAuthor({ name: username, iconURL: avatarURL })
    .setTitle("🎣 釣魚成功！")
    .setColor("#3498db" as ColorResolvable)
    .setDescription(
      [
        `▷ 釣到了一隻 \`${result.item.name}\`（${rarityLabel}）`,
        `▷ 目前擁有 ${chip(result.quantity)} 隻`,
        `▷ 獲得經驗 ${chip(result.xpGained)} ✨`,
      ].join("\n")
    );

  const unitPrice = ItemService.getSellPricePerUnit(result.item);
  return {
    embeds: [embed],
    components: [buildFishActionRow(userId, result.item.name, unitPrice, result.quantity)],
  };
}

export async function handleFishCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();
    const payload = await runFishAndBuildReply(
      interaction.user.id,
      interaction.user.username,
      interaction.user.displayAvatarURL()
    );
    return interaction.editReply(payload);
  } catch (error) {
    console.error("RPG Fish 命令錯誤:", error);
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`釣魚失敗：${message}`);
  }
}

// interactionCreate.ts 會把 "fish_retry:*" 的按鈕點擊導到這裡
// 發新訊息、不動原本那張卡片：跟 battle 的「再戰一次」同樣的道理，編輯原地不會把卡片頂到頻道最下面
export async function handleFishRetryButton(interaction: ButtonInteraction) {
  const { ownerId } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;

  await interaction.deferReply();
  try {
    const payload = await runFishAndBuildReply(
      interaction.user.id,
      interaction.user.username,
      interaction.user.displayAvatarURL()
    );
    await interaction.editReply(payload);
  } catch (error) {
    await interaction.deleteReply();
    const message = error instanceof Error ? error.message : String(error);
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  }
}

// fish_sell、fish_sell_all 兩顆按鈕共用：賣完後把卡片改成灰色、附加「已賣出」欄位；
// 「再釣一次」按鈕保留下來（不隨賣出動作清空），可以連續捕魚不用重打指令；失敗不動原本卡片
async function handleFishSellInteraction(
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

    const retryRow = new ActionRowBuilder<ButtonBuilder>().addComponents(buildFishRetryButton(ownerId));
    await interaction.editReply({ embeds: [embed], components: [retryRow] });
  } catch (error) {
    // 賣不掉（例如剛好被裝備上、或已經賣完了）不動原本卡片，只用 ephemeral 提示
    const message = error instanceof Error ? error.message : String(error);
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  }
}

// interactionCreate.ts 會把 "fish_sell:*" 的按鈕點擊導到這裡；只賣掉剛釣到的這一隻，不是全部
export async function handleFishSellButton(interaction: ButtonInteraction) {
  await handleFishSellInteraction(interaction, (userId, itemName) =>
    ItemService.sellItem(userId, itemName)
  );
}

// interactionCreate.ts 會把 "fish_sell_all:*" 的按鈕點擊導到這裡；賣掉背包裡這個魚種的全部庫存
export async function handleFishSellAllButton(interaction: ButtonInteraction) {
  await handleFishSellInteraction(interaction, (userId, itemName) =>
    ItemService.sellAllOfItem(userId, itemName)
  );
}
