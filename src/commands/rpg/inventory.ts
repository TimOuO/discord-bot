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
import { ItemService, TYPE_EMOJIS, formatEffectValue, ACCESSORY_SLOTS } from "../../services/itemService";
import type { EquipSlot } from "../../services/itemService";
import { sectionField, chip } from "../../utils/embeds";
import { buildCustomId, parseCustomId, requireInteractionOwner } from "../../utils/interactions";

const PAGE_SIZE = 10;

type InventoryView = {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
};

// 每件裝備旁邊直接標出它加了什麼數值，不用另外去換算「有效屬性」總和是怎麼來的；
// 神話級鍛造裝備有第二種效果（effectType2/effectValue2）時一併列出
function formatEquippedItem(item: {
  name: string;
  effectType: string;
  effectValue: number;
  effectType2?: string | null;
  effectValue2?: number | null;
}): string {
  const effects = [formatEffectValue(item.effectType, item.effectValue)];
  if (item.effectType2 && item.effectValue2 != null) {
    effects.push(formatEffectValue(item.effectType2, item.effectValue2));
  }
  return `${item.name}（${effects.join("、")}）`;
}

// 不用記憶體存分頁狀態，customId 直接帶頁碼，資料每次都即時查，機器人重啟也不會讓按鈕失效
async function buildInventoryView(
  discordUserId: string,
  ownerId: string,
  page: number,
  username: string,
  avatarURL: string,
  selectedItemName?: string
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
      sectionField("🎒", "裝備欄", (() => {
        const weaponEq = equipped.find((e) => e.slot === "weapon")?.equipped;
        const armorEq = equipped.find((e) => e.slot === "armor")?.equipped;
        // 飾品欄 1/2/3 對玩家來說沒有實質差異，合併成一行顯示，不用暴露內部欄位編號
        const accessoryEqs = equipped
          .filter((e) => (ACCESSORY_SLOTS as readonly string[]).includes(e.slot))
          .map((e) => e.equipped)
          .filter((eq): eq is NonNullable<typeof eq> => eq !== null);

        return [
          `武器：${weaponEq ? formatEquippedItem(weaponEq.item) : "（空）"}`,
          `防具：${armorEq ? formatEquippedItem(armorEq.item) : "（空）"}`,
          `飾品：${accessoryEqs.length > 0 ? accessoryEqs.map((eq) => formatEquippedItem(eq.item)).join("、") : "（空）"}`,
        ];
      })())
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
        // 選單重繪時要標記目前選的是哪個，不然畫面會跳回「未選擇」，看不出下面的按鈕是對哪個道具生效
        default: row.item.name === selectedItemName,
      }))
    );
  components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));

  return { embeds: [embed], components };
}

// 飾品欄都滿時不能悶著頭自動選一欄頂掉，要讓玩家自己指定換哪一欄，
// 所以這裡要另外查目前的裝備狀態，跟其他分支不一樣
async function buildItemActionRow(
  userInternalId: string,
  ownerId: string,
  page: number,
  itemType: string,
  itemName: string
): Promise<ActionRowBuilder<ButtonBuilder>> {
  const buttons: ButtonBuilder[] = [];

  if (itemType === "weapon" || itemType === "armor") {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(buildCustomId("inv_equip", ownerId, String(page), itemName))
        .setLabel("裝備")
        .setEmoji("🛡️")
        .setStyle(ButtonStyle.Primary)
    );
  } else if (itemType === "accessory") {
    const equipped = await ItemService.getEquipped(userInternalId);
    const bySlot = ACCESSORY_SLOTS.map((slot) => equipped.find((e) => e.slot === slot)?.equipped ?? null);
    const hasEmptySlot = bySlot.some((eq) => !eq);

    if (hasEmptySlot) {
      // 至少一欄是空的，不會有歧義，直接用自動選擇邏輯裝上去
      buttons.push(
        new ButtonBuilder()
          .setCustomId(buildCustomId("inv_equip", ownerId, String(page), itemName))
          .setLabel("裝備")
          .setEmoji("🛡️")
          .setStyle(ButtonStyle.Primary)
      );
    } else {
      ACCESSORY_SLOTS.forEach((slot, i) => {
        const eq = bySlot[i]!;
        buttons.push(
          new ButtonBuilder()
            .setCustomId(buildCustomId("inv_equip_slot", ownerId, String(page), itemName, slot))
            .setLabel(`換掉「${eq.item.name}」`)
            .setEmoji("🛡️")
            .setStyle(ButtonStyle.Primary)
        );
      });
    }
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
      interaction.user.displayAvatarURL(),
      itemName
    );
    const item = await ItemService.findItemByName(itemName);
    if (item) {
      const user = await RPGService.findUserByDiscordId(interaction.user.id);
      if (user) {
        view.components.push(await buildItemActionRow(user.id, ownerId, page, item.type, item.name));
      }
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

// interactionCreate.ts 會把 "inv_equip_slot:*" 的按鈕點擊導到這裡；飾品兩欄都滿時，指定要換掉哪一欄
export async function handleInventoryEquipSlotButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const [pageStr, itemName, slot] = args;
  const page = parseInt(pageStr, 10);

  await interaction.deferUpdate();
  try {
    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) throw new Error("找不到你的角色資料");
    await ItemService.equipItem(user.id, itemName, slot as EquipSlot);
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
