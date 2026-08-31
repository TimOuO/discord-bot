import {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  ButtonInteraction,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ColorResolvable,
  MessageFlags,
} from "discord.js";
import { RPGService } from "../../services/rpgService";
import { ItemService, SLOT_GROUP_LABELS } from "../../services/itemService";
import type { Item } from "../../generated/prisma";
import { chip } from "../../utils/embeds";
import { buildCustomId, parseCustomId, requireInteractionOwner } from "../../utils/interactions";

export async function handleShopBuy(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) {
      return interaction.editReply(
        "你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！"
      );
    }

    const itemName = interaction.options.getString("item", true);
    const { item, quantity, autoEquippedSlot } = await ItemService.buyItem(
      user.id,
      itemName
    );

    const equipNote = autoEquippedSlot
      ? `，並自動裝備為${SLOT_GROUP_LABELS[autoEquippedSlot]}！`
      : "";

    return interaction.editReply(
      `✅ 花費 ${item.cost} 金幣購買了「${item.name}」！目前擁有 ${quantity} 個${equipNote}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`購買失敗：${message}`);
  }
}

function buildSellAllRow(
  ownerId: string,
  itemName: string,
  remainingQuantity: number,
  totalPrice: number
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId("shop_sell_all", ownerId, itemName))
      .setLabel(`全部賣掉（${remainingQuantity} 個・${totalPrice} 金幣）`)
      .setEmoji("💰")
      .setStyle(ButtonStyle.Secondary)
  );
}

// 賣完之後查一次還剩幾個賣得動，有剩才顯示「全部賣掉」按鈕；按鈕上直接標總價，不用點下去才知道
async function buildSellReply(
  userInternalId: string,
  ownerId: string,
  item: Item,
  sellPrice: number,
  goldAfter: number
) {
  const inventory = await ItemService.getInventory(userInternalId);
  const remaining = inventory.find((row) => row.itemId === item.id)?.quantity ?? 0;

  const embed = new EmbedBuilder()
    .setColor("#95a5a6" as ColorResolvable)
    .setDescription(`💰 賣掉「${item.name}」，獲得 ${sellPrice} 金幣（目前 ${goldAfter} 金幣）。`);

  if (remaining <= 0) return { embeds: [embed], components: [] };

  const totalPrice = ItemService.getSellPricePerUnit(item) * remaining;
  return { embeds: [embed], components: [buildSellAllRow(ownerId, item.name, remaining, totalPrice)] };
}

export async function handleShopSell(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) {
      return interaction.editReply(
        "你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！"
      );
    }

    const itemName = interaction.options.getString("item", true);
    const sellAll = interaction.options.getBoolean("all") ?? false;

    if (sellAll) {
      const { item, sellPrice, amount, goldAfter } = await ItemService.sellAllOfItem(user.id, itemName);
      const embed = new EmbedBuilder()
        .setColor("#95a5a6" as ColorResolvable)
        .setDescription(`💰 全部賣掉「${item.name}」x${amount}，獲得 ${sellPrice} 金幣（目前 ${goldAfter} 金幣）。`);
      return interaction.editReply({ embeds: [embed] });
    }

    const { item, sellPrice, goldAfter } = await ItemService.sellItem(user.id, itemName);
    const payload = await buildSellReply(user.id, interaction.user.id, item, sellPrice, goldAfter);
    return interaction.editReply(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`販賣失敗：${message}`);
  }
}

// interactionCreate.ts 會把 "shop_sell_all:*" 的按鈕點擊導到這裡；賣掉「賣得動的全部」，裝備中的不會被賣
export async function handleShopSellAllButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;

  const itemName = args[0];

  await interaction.deferUpdate();
  try {
    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) throw new Error("找不到你的角色資料");

    const { sellPrice, amount, goldAfter } = await ItemService.sellAllOfItem(user.id, itemName);

    const embed = new EmbedBuilder()
      .setColor("#95a5a6" as ColorResolvable)
      .setDescription(`💰 全部賣掉「${itemName}」x${amount}，獲得 ${sellPrice} 金幣（目前 ${goldAfter} 金幣）。`);

    await interaction.editReply({ embeds: [embed], components: [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  }
}

export async function shopBuyAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused().trim();
  const items = await ItemService.getShopCatalog();
  const filtered = items.filter((item) => item.name.includes(focused)).slice(0, 25);
  return interaction.respond(
    filtered.map((item) => ({
      name: `${item.name}（${item.cost} 金幣）`,
      value: item.name,
    }))
  );
}

export async function shopSellAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused().trim();
  const user = await RPGService.findUserByDiscordId(interaction.user.id);
  if (!user) return interaction.respond([]);

  const inventory = await ItemService.getInventory(user.id);
  const filtered = inventory
    .filter((row) => row.item.name.includes(focused))
    .slice(0, 25);
  return interaction.respond(
    filtered.map((row) => {
      const unitPrice = ItemService.getSellPricePerUnit(row.item);
      const priceNote =
        row.quantity > 1
          ? `賣 1 隻 ${unitPrice} 金幣・全賣 ${unitPrice * row.quantity} 金幣`
          : `賣 ${unitPrice} 金幣`;
      return {
        name: `${row.item.name} x${row.quantity}（${priceNote}）`,
        value: row.item.name,
      };
    })
  );
}
