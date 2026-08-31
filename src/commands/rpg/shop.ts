import {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
  ColorResolvable,
  MessageFlags,
} from "discord.js";
import { RPGService } from "../../services/rpgService";
import {
  ItemService,
  TYPE_LABELS,
  TYPE_EMOJIS,
  EFFECT_TYPE_LABELS,
  SLOT_LABELS,
} from "../../services/itemService";
import { sectionField, chip } from "../../utils/embeds";

export async function handleShopList(interaction: ChatInputCommandInteraction) {
  const items = await ItemService.getShopCatalog();

  const embed = new EmbedBuilder()
    .setTitle("🛒 商店")
    .setColor("#f39c12" as ColorResolvable)
    .setFooter({ text: "使用 /rpg shop buy 購買道具、/rpg shop sell 販賣道具" });

  for (const type of Object.keys(TYPE_LABELS)) {
    const itemsOfType = items.filter((item) => item.type === type);
    if (itemsOfType.length === 0) continue;

    const lines = itemsOfType.map((item) => {
      const effectLabel = EFFECT_TYPE_LABELS[item.effectType] ?? item.effectType;
      return `**${item.name}** — ${chip(item.cost)} 金幣（${effectLabel} +${chip(item.effectValue)}）${item.description}`;
    });

    embed.addFields(sectionField(TYPE_EMOJIS[type] ?? "🛒", TYPE_LABELS[type], lines));
  }

  return interaction.reply({ embeds: [embed] });
}

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
      ? `，並自動裝備到${SLOT_LABELS[autoEquippedSlot]}欄！`
      : "";

    return interaction.editReply(
      `✅ 花費 ${item.cost} 金幣購買了「${item.name}」！目前擁有 ${quantity} 個${equipNote}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`購買失敗：${message}`);
  }
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
    const { item, sellPrice } = await ItemService.sellItem(user.id, itemName);

    return interaction.editReply(`💰 賣掉「${item.name}」，獲得 ${sellPrice} 金幣。`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`販賣失敗：${message}`);
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
    filtered.map((row) => ({
      name: `${row.item.name} x${row.quantity}（賣 ${Math.floor(row.item.cost * 0.5)} 金幣）`,
      value: row.item.name,
    }))
  );
}
