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
import { ItemService, TYPE_EMOJIS, SLOT_LABELS } from "../../services/itemService";
import { sectionField, chip } from "../../utils/embeds";
import { buildCustomId, parseCustomId, requireInteractionOwner } from "../../utils/interactions";

const PAGE_SIZE = 10;
const EQUIPPABLE_TYPES = ["weapon", "armor", "accessory"];

type InventoryView = {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
};

// 不用記憶體存分頁狀態，customId 直接帶頁碼，資料每次都即時查，機器人重啟也不會讓按鈕失效
async function buildInventoryView(
  discordUserId: string,
  ownerId: string,
  page: number,
  username: string,
  avatarURL: string
): Promise<InventoryView> {
  const user = await RPGService.findUserByDiscordId(discordUserId);
  if (!user) {
    throw new Error("你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！");
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
    .setAuthor({ name: username, iconURL: avatarURL })
    .setTitle(`${username} 的背包`)
    .setColor("#9b59b6" as ColorResolvable)
    .setFooter({ text: "選單選道具後可以直接裝備/使用/賣掉" })
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

  const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

  if (inventory.length === 0) {
    embed.addFields(sectionField("🧳", "道具", ["背包是空的，去 `/rpg shop list` 逛逛吧！"]));
    return { embeds: [embed], components };
  }

  const totalPages = Math.max(1, Math.ceil(inventory.length / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const pageItems = inventory.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  const lines = pageItems.map((row) => {
    const emoji = TYPE_EMOJIS[row.item.type] ?? "🧳";
    const equippedTag = equippedItemIds.has(row.itemId) ? "（裝備中）" : "";
    return `${emoji} ${row.item.name} x${chip(row.quantity)}${equippedTag}`;
  });
  embed.addFields(sectionField("🧳", `道具（第 ${clampedPage + 1}/${totalPages} 頁）`, lines));

  if (totalPages > 1) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildCustomId("inv_page", ownerId, String(clampedPage - 1)))
          .setLabel("◀ 上一頁")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(clampedPage === 0),
        new ButtonBuilder()
          .setCustomId(buildCustomId("inv_page", ownerId, String(clampedPage + 1)))
          .setLabel("下一頁 ▶")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(clampedPage === totalPages - 1)
      )
    );
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId("inv_select", ownerId, String(clampedPage)))
    .setPlaceholder("選一個道具來裝備/使用/賣掉")
    .addOptions(
      pageItems.map((row) => ({
        label: `${row.item.name} x${row.quantity}`,
        value: row.item.name,
      }))
    );
  components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));

  return { embeds: [embed], components };
}

function buildItemActionRow(
  ownerId: string,
  page: number,
  itemType: string,
  itemName: string
): ActionRowBuilder<ButtonBuilder> {
  const buttons: ButtonBuilder[] = [];

  if (EQUIPPABLE_TYPES.includes(itemType)) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(buildCustomId("inv_equip", ownerId, String(page), itemName))
        .setLabel("裝備")
        .setEmoji("🛡️")
        .setStyle(ButtonStyle.Primary)
    );
  }
  if (itemType === "potion") {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(buildCustomId("inv_use", ownerId, String(page), itemName))
        .setLabel("使用")
        .setEmoji("🧪")
        .setStyle(ButtonStyle.Primary)
    );
  }
  buttons.push(
    new ButtonBuilder()
      .setCustomId(buildCustomId("inv_sell", ownerId, String(page), itemName))
      .setLabel("全部賣掉")
      .setEmoji("💰")
      .setStyle(ButtonStyle.Secondary)
  );

  return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}

export async function handleInventoryCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const view = await buildInventoryView(
      interaction.user.id,
      interaction.user.id,
      0,
      interaction.user.username,
      interaction.user.displayAvatarURL()
    );
    return interaction.editReply(view);
  } catch (error) {
    console.error("RPG Inventory 命令錯誤:", error);
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`查看背包失敗：${message}`);
  }
}

export async function handleInventoryPageButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const page = parseInt(args[0], 10);

  await interaction.deferUpdate();
  try {
    const view = await buildInventoryView(
      interaction.user.id,
      ownerId,
      page,
      interaction.user.username,
      interaction.user.displayAvatarURL()
    );
    await interaction.editReply(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.editReply({ content: message, embeds: [], components: [] });
  }
}

export async function handleInventorySelect(interaction: StringSelectMenuInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const page = parseInt(args[0], 10);
  const itemName = interaction.values[0];

  await interaction.deferUpdate();
  try {
    const view = await buildInventoryView(
      interaction.user.id,
      ownerId,
      page,
      interaction.user.username,
      interaction.user.displayAvatarURL()
    );
    const item = await ItemService.findItemByName(itemName);
    if (item) {
      view.components.push(buildItemActionRow(ownerId, page, item.type, item.name));
    }
    await interaction.editReply(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.editReply({ content: message, embeds: [], components: [] });
  }
}

// equip/use/sell 共用：動作做完就回到「純瀏覽」狀態，不繼續顯示該道具的動作按鈕
async function refreshInventoryView(interaction: ButtonInteraction, ownerId: string, page: number) {
  const view = await buildInventoryView(
    interaction.user.id,
    ownerId,
    page,
    interaction.user.username,
    interaction.user.displayAvatarURL()
  );
  await interaction.editReply(view);
}

function parsePageAndItemName(args: string[]): { page: number; itemName: string } {
  const [pageStr, itemName] = args;
  return { page: parseInt(pageStr, 10), itemName };
}

export async function handleInventoryEquipButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const { page, itemName } = parsePageAndItemName(args);

  await interaction.deferUpdate();
  try {
    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) throw new Error("找不到你的角色資料");
    await ItemService.equipItem(user.id, itemName);
    await refreshInventoryView(interaction, ownerId, page);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.followUp({ content: `裝備失敗：${message}`, flags: MessageFlags.Ephemeral });
  }
}

export async function handleInventoryUseButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const { page, itemName } = parsePageAndItemName(args);

  await interaction.deferUpdate();
  try {
    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) throw new Error("找不到你的角色資料");
    await ItemService.useItem(user.id, itemName);
    await refreshInventoryView(interaction, ownerId, page);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.followUp({ content: `使用失敗：${message}`, flags: MessageFlags.Ephemeral });
  }
}

export async function handleInventorySellButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const { page, itemName } = parsePageAndItemName(args);

  await interaction.deferUpdate();
  try {
    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) throw new Error("找不到你的角色資料");
    await ItemService.sellAllOfItem(user.id, itemName);
    await refreshInventoryView(interaction, ownerId, page);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.followUp({ content: `販賣失敗：${message}`, flags: MessageFlags.Ephemeral });
  }
}
