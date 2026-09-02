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
import {
  ItemService,
  TYPE_EMOJIS,
  TYPE_LABELS,
  EQUIPPABLE_TYPES,
  formatEffectValue,
  SLOT_GROUP_LABELS,
} from "../../services/itemService";
import type { Item } from "../../generated/prisma";
import { sectionField, chip } from "../../utils/embeds";
import { buildCustomId, parseCustomId, requireInteractionOwner } from "../../utils/interactions";

const PAGE_SIZE = 10;
const MAX_BUY_QUANTITY = 99;

type ShopView = {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
};

function formatItemEffects(item: Item): string {
  const effects = [formatEffectValue(item.effectType, item.effectValue)];
  if (item.effectType2 && item.effectValue2 != null) {
    effects.push(formatEffectValue(item.effectType2, item.effectValue2));
  }
  return effects.join("、");
}

// 買得起幾個就給幾個選（上限 99，避免數字誇張），金幣不夠買 1 個時回傳 0
function computeMaxBuyable(gold: number, cost: number): number {
  if (cost <= 0) return MAX_BUY_QUANTITY;
  return Math.max(0, Math.min(MAX_BUY_QUANTITY, Math.floor(gold / cost)));
}

// 不用記憶體存分頁狀態，customId 直接帶頁碼，資料每次都即時查，機器人重啟也不會讓按鈕失效；
// 商店清單本身是公開資訊（誰都能看），但只有當初下指令的人（ownerId）能操作按鈕/選單
async function buildShopView(
  ownerDiscordId: string,
  ownerId: string,
  page: number,
  selectedItemName?: string
): Promise<ShopView> {
  const items = await ItemService.getShopCatalog();
  const owner = await RPGService.findUserByDiscordId(ownerDiscordId);
  const equipped = owner ? await ItemService.getEquipped(owner.id) : [];

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

  // 照類型分類、插入分類標題；同一頁裡類型一換就插新標題，武器/防具/飾品優先顯示在前面幾頁
  const lines: string[] = [];
  let lastType: string | null = null;
  for (const item of pageItems) {
    if (item.type !== lastType) {
      lastType = item.type;
      const headerEmoji = TYPE_EMOJIS[item.type] ?? "🛒";
      const headerLabel = TYPE_LABELS[item.type] ?? item.type;
      lines.push(`${headerEmoji}｜${headerLabel}`);
    }

    const effectText =
      EQUIPPABLE_TYPES.includes(item.type) && owner
        ? ItemService.computeEquipComparison(item.type, item, equipped)
        : formatItemEffects(item);
    lines.push(`　**${item.name}** — ${chip(item.cost)} 金幣（${effectText}）`);
  }
  embed.addFields(sectionField("🛒", `商品（第 ${clampedPage + 1}/${totalPages} 頁）`, lines));
  embed.setFooter({ text: "選單選商品後可以用按鈕選數量購買" });

  if (totalPages > 1) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildCustomId("shop_page", ownerId, String(clampedPage - 1)))
          .setLabel("◀ 上一頁")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(clampedPage === 0),
        new ButtonBuilder()
          .setCustomId(buildCustomId("shop_page", ownerId, String(clampedPage + 1)))
          .setLabel("下一頁 ▶")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(clampedPage === totalPages - 1)
      )
    );
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId("shop_select", ownerId, String(clampedPage)))
    .setPlaceholder("選一個商品來購買")
    .addOptions(
      pageItems.map((item) => ({
        label: `${item.name}（${item.cost} 金幣・${formatItemEffects(item)}）`.slice(0, 100),
        value: item.name,
        default: item.name === selectedItemName,
      }))
    );
  components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));

  return { embeds: [embed], components };
}

// 加減按鈕＋中間的確認鍵放同一排（Discord 一排最多 5 顆按鈕，剛好塞下）；
// qty 卡在 [1, maxQty]，買不起（maxQty 0）時確認鍵會被停用但仍然看得到價格。
// customId 帶的是「目前數量＋位移量」而不是預先算好的目標值——目標值在 qty 接近上下限時，
// -5 跟 -1（或 +1 跟 +5）夾出來的結果可能會一樣，若直接把目標值編進 customId 會撞成重複 ID，
// Discord 會直接拒收整張卡片；改成帶位移量，實際目標值交給按下去之後的 handler 去夾，永遠不會撞
function buildBuyQuantityRow(
  ownerId: string,
  page: number,
  itemName: string,
  qty: number,
  cost: number,
  maxQty: number
): ActionRowBuilder<ButtonBuilder> {
  const atMin = qty <= 1;
  const atMax = qty >= maxQty;

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId("shop_qty", ownerId, String(page), itemName, String(qty), "-5"))
      .setLabel("-5")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atMin),
    new ButtonBuilder()
      .setCustomId(buildCustomId("shop_qty", ownerId, String(page), itemName, String(qty), "-1"))
      .setLabel("-1")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atMin),
    new ButtonBuilder()
      .setCustomId(buildCustomId("shop_buy", ownerId, String(page), itemName, String(qty)))
      .setLabel(maxQty < 1 ? "金幣不夠" : `確認購買 x${qty}（${cost * qty} 金幣）`)
      .setEmoji("🛍️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(qty > maxQty || maxQty < 1),
    new ButtonBuilder()
      .setCustomId(buildCustomId("shop_qty", ownerId, String(page), itemName, String(qty), "1"))
      .setLabel("+1")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atMax),
    new ButtonBuilder()
      .setCustomId(buildCustomId("shop_qty", ownerId, String(page), itemName, String(qty), "5"))
      .setLabel("+5")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atMax)
  );
}

async function pushQuantityRow(
  view: ShopView,
  discordUserId: string,
  ownerId: string,
  page: number,
  itemName: string,
  qty: number
) {
  const item = await ItemService.findItemByName(itemName);
  if (!item) return;

  const user = await RPGService.findUserByDiscordId(discordUserId);
  const maxQty = user ? computeMaxBuyable(user.gold, item.cost) : 0;
  const clampedQty = Math.min(Math.max(1, qty), Math.max(maxQty, 1));
  view.components.push(buildBuyQuantityRow(ownerId, page, item.name, clampedQty, item.cost, maxQty));
}

export async function handleShopCommand(interaction: ChatInputCommandInteraction) {
  const view = await buildShopView(interaction.user.id, interaction.user.id, 0);
  return interaction.reply(view);
}

export async function handleShopPageButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const page = parseInt(args[0], 10);

  await interaction.deferUpdate();
  const view = await buildShopView(interaction.user.id, ownerId, page);
  await interaction.editReply(view);
}

export async function handleShopSelect(interaction: StringSelectMenuInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const page = parseInt(args[0], 10);
  const itemName = interaction.values[0];

  await interaction.deferUpdate();
  const view = await buildShopView(interaction.user.id, ownerId, page, itemName);
  await pushQuantityRow(view, interaction.user.id, ownerId, page, itemName, 1);
  await interaction.editReply(view);
}

// interactionCreate.ts 會把 "shop_qty:*" 的按鈕點擊導到這裡；只調整數量、還沒真的購買
export async function handleShopQtyButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const [pageStr, itemName, currentQtyStr, deltaStr] = args;
  const page = parseInt(pageStr, 10);
  const nextQty = parseInt(currentQtyStr, 10) + parseInt(deltaStr, 10);

  await interaction.deferUpdate();
  const view = await buildShopView(interaction.user.id, ownerId, page, itemName);
  await pushQuantityRow(view, interaction.user.id, ownerId, page, itemName, nextQty);
  await interaction.editReply(view);
}

// interactionCreate.ts 會把 "shop_buy:*" 的按鈕點擊導到這裡，真的執行購買
export async function handleShopBuyButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const [pageStr, itemName, qtyStr] = args;
  const page = parseInt(pageStr, 10);
  const qty = Math.max(1, parseInt(qtyStr, 10) || 1);

  await interaction.deferUpdate();
  try {
    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) throw new Error("你尚未開始 RPG 冒險，請先使用 /rpg start 命令開始遊戲！");

    const { item, quantity, boughtAmount, totalCost, autoEquippedSlot } = await ItemService.buyItem(
      user.id,
      itemName,
      qty
    );
    const equipNote = autoEquippedSlot ? `，並自動裝備為${SLOT_GROUP_LABELS[autoEquippedSlot]}！` : "";

    // 買完回到純瀏覽狀態（跟 inventory 的快捷操作一致），確認訊息只有買的人自己看得到
    const view = await buildShopView(interaction.user.id, ownerId, page);
    await interaction.editReply(view);
    await interaction.followUp({
      content: `✅ 花費 ${totalCost} 金幣購買了「${item.name}」x${boughtAmount}！目前擁有 ${quantity} 個${equipNote}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.followUp({ content: `購買失敗：${message}`, flags: MessageFlags.Ephemeral });
  }
}
