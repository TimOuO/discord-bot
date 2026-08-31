import {
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  EmbedBuilder,
  ColorResolvable,
  MessageFlags,
} from "discord.js";
import { RPGService } from "../../services/rpgService";
import { ItemService, TYPE_EMOJIS, EFFECT_TYPE_LABELS, SLOT_GROUP_LABELS } from "../../services/itemService";
import { sectionField, chip } from "../../utils/embeds";
import { buildCustomId, parseCustomId, requireInteractionOwner } from "../../utils/interactions";

const PAGE_SIZE = 10;

type ShopListView = {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
};

// 不用記憶體存分頁狀態，customId 直接帶頁碼，資料每次都即時查，機器人重啟也不會讓按鈕失效；
// 商店清單本身是公開資訊（誰都能看），但只有當初下指令的人（ownerId）能操作按鈕/選單
async function buildShopListView(
  ownerDiscordId: string,
  ownerId: string,
  page: number,
  selectedItemName?: string
): Promise<ShopListView> {
  const items = await ItemService.getShopCatalog();
  const owner = await RPGService.findUserByDiscordId(ownerDiscordId);

  const embed = new EmbedBuilder()
    .setTitle("🛒 商店")
    .setColor("#f39c12" as ColorResolvable);

  if (owner) {
    embed.addFields(sectionField("💰", "你的金幣", [`${chip(owner.gold)}`]));
  }

  const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

  if (items.length === 0) {
    embed.addFields(sectionField("🛒", "商品", ["商店目前沒有東西可以買"]));
    return { embeds: [embed], components };
  }

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const pageItems = items.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  const lines = pageItems.map((item) => {
    const emoji = TYPE_EMOJIS[item.type] ?? "🛒";
    const effectLabel = EFFECT_TYPE_LABELS[item.effectType] ?? item.effectType;
    return `${emoji} **${item.name}** — ${chip(item.cost)} 金幣（${effectLabel} +${chip(item.effectValue)}）`;
  });
  embed.addFields(sectionField("🛒", `商品（第 ${clampedPage + 1}/${totalPages} 頁）`, lines));
  embed.setFooter({ text: "選單選商品後可以直接購買" });

  if (totalPages > 1) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildCustomId("shoplist_page", ownerId, String(clampedPage - 1)))
          .setLabel("◀ 上一頁")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(clampedPage === 0),
        new ButtonBuilder()
          .setCustomId(buildCustomId("shoplist_page", ownerId, String(clampedPage + 1)))
          .setLabel("下一頁 ▶")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(clampedPage === totalPages - 1)
      )
    );
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId("shoplist_select", ownerId, String(clampedPage)))
    .setPlaceholder("選一個商品來購買")
    .addOptions(
      pageItems.map((item) => ({
        label: `${item.name}（${item.cost} 金幣）`,
        value: item.name,
        default: item.name === selectedItemName,
      }))
    );
  components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));

  return { embeds: [embed], components };
}

function buildBuyButtonRow(ownerId: string, page: number, itemName: string, cost: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId("shoplist_buy", ownerId, String(page), itemName))
      .setLabel(`購買（${cost} 金幣）`)
      .setEmoji("🛍️")
      .setStyle(ButtonStyle.Primary)
  );
}

export async function handleShopListCommand(interaction: ChatInputCommandInteraction) {
  const view = await buildShopListView(interaction.user.id, interaction.user.id, 0);
  return interaction.reply(view);
}

export async function handleShopListPageButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const page = parseInt(args[0], 10);

  await interaction.deferUpdate();
  const view = await buildShopListView(interaction.user.id, ownerId, page);
  await interaction.editReply(view);
}

export async function handleShopListSelect(interaction: StringSelectMenuInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const page = parseInt(args[0], 10);
  const itemName = interaction.values[0];

  await interaction.deferUpdate();
  const view = await buildShopListView(interaction.user.id, ownerId, page, itemName);

  const item = await ItemService.findItemByName(itemName);
  if (item) {
    view.components.push(buildBuyButtonRow(ownerId, page, item.name, item.cost));
  }
  await interaction.editReply(view);
}

// interactionCreate.ts 會把 "shoplist_buy:*" 的按鈕點擊導到這裡
export async function handleShopListBuyButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const [pageStr, itemName] = args;
  const page = parseInt(pageStr, 10);

  await interaction.deferUpdate();
  try {
    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) throw new Error("你尚未開始 RPG 冒險，請先使用 /rpg start 命令開始遊戲！");

    const { item, quantity, autoEquippedSlot } = await ItemService.buyItem(user.id, itemName);
    const equipNote = autoEquippedSlot ? `，並自動裝備為${SLOT_GROUP_LABELS[autoEquippedSlot]}！` : "";

    // 買完回到純瀏覽狀態（跟 inventory 的快捷操作一致），確認訊息只有買的人自己看得到
    const view = await buildShopListView(interaction.user.id, ownerId, page);
    await interaction.editReply(view);
    await interaction.followUp({
      content: `✅ 花費 ${item.cost} 金幣購買了「${item.name}」！目前擁有 ${quantity} 個${equipNote}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.followUp({ content: `購買失敗：${message}`, flags: MessageFlags.Ephemeral });
  }
}
