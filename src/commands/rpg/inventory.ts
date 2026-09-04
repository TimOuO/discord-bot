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
  ACCESSORY_SLOTS,
  formatEffectValue,
} from "../../services/itemService";
import type { EquipSlot, InventoryEntry } from "../../services/itemService";
import type { Item } from "../../generated/prisma";
import { sectionField, chip } from "../../utils/embeds";
import { buildCustomId, parseCustomId, requireInteractionOwner } from "../../utils/interactions";

const PAGE_SIZE = 10;

type InventoryView = {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
};

/** 強化等級的後綴，+0 不顯示（大多數裝備都是 +0，每件都掛個 +0 只是雜訊） */
function enhanceSuffix(enhanceLevel: number): string {
  return enhanceLevel > 0 ? ` +${enhanceLevel}` : "";
}

// 每件裝備旁邊直接標出它加了什麼數值，不用另外去換算「有效屬性」總和是怎麼來的；
// 數值是算過強化倍率的實際值，神話級鍛造裝備的第二效果也一併列出
function formatEquippedItem(item: Item, enhanceLevel: number): string {
  const effects = ItemService.describeInstanceEffects(item, enhanceLevel).map((e) =>
    formatEffectValue(e.type, e.value)
  );
  return `${item.name}${enhanceSuffix(enhanceLevel)}（${effects.join("、")}）`;
}

// 選單/按鈕要精準指到「哪一筆」：裝備指到實體 id（同名的 +7 跟 +0 是兩件不同的東西），
// 可堆疊的道具用名稱就夠了（個體之間沒有差異）
function entryKey(entry: InventoryEntry): string {
  return entry.kind === "instance" ? entry.instanceId : entry.item.name;
}

function entryLabel(entry: InventoryEntry): string {
  return entry.kind === "instance"
    ? `${entry.item.name}${enhanceSuffix(entry.enhanceLevel)}`
    : `${entry.item.name} x${entry.quantity}`;
}

// 不用記憶體存分頁狀態，customId 直接帶頁碼，資料每次都即時查，機器人重啟也不會讓按鈕失效
async function buildInventoryView(
  discordUserId: string,
  ownerId: string,
  page: number,
  username: string,
  avatarURL: string,
  selectedKey?: string
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

  const embed = new EmbedBuilder()
    .setAuthor({ name: username, iconURL: avatarURL })
    .setTitle(`${username} 的背包`)
    .setColor("#9b59b6" as ColorResolvable)
    .setFooter({ text: "選單選道具後可以直接裝備/使用/賣掉" })
    .addFields(
      sectionField("💰", "金幣", [`${chip(user.gold)}`]),
      sectionField("📊", "有效屬性（基礎 + 裝備加成）", [
        `攻擊力 ${chip(effectiveStats.attack)}（基礎 ${chip(user.attack)}）`,
        `防禦力 ${chip(effectiveStats.defense)}（基礎 ${chip(user.defense)}）`,
        `生命上限 ${chip(effectiveStats.maxHealth)}（基礎 ${chip(user.maxHealth)}）`,
      ]),
      sectionField("🎒", "裝備欄", (() => {
        const weaponEq = equipped.find((e) => e.slot === "weapon")?.equipped;
        const armorEq = equipped.find((e) => e.slot === "armor")?.equipped;
        // 飾品欄 1/2/3 對玩家來說沒有實質差異，不暴露內部欄位編號；
        // 但每一格都要各自列出（含空格），不然只裝了 1、2 件時看不出來還有空位可以裝
        const accessoryLines = ACCESSORY_SLOTS.map((slot) => {
          const eq = equipped.find((e) => e.slot === slot)?.equipped;
          return eq ? formatEquippedItem(eq.item, eq.enhanceLevel) : "（空）";
        });
        const filledCount = accessoryLines.filter((line) => line !== "（空）").length;

        return [
          `武器：${weaponEq ? formatEquippedItem(weaponEq.item, weaponEq.enhanceLevel) : "（空）"}`,
          `防具：${armorEq ? formatEquippedItem(armorEq.item, armorEq.enhanceLevel) : "（空）"}`,
          `飾品（${filledCount}/${ACCESSORY_SLOTS.length}）：${accessoryLines.join("、")}`,
        ];
      })())
    );

  const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

  if (inventory.length === 0) {
    embed.addFields(sectionField("🧳", "道具", ["背包是空的，去 `/rpg shop` 逛逛吧！"]));
    return { embeds: [embed], components };
  }

  const totalPages = Math.max(1, Math.ceil(inventory.length / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const pageItems = inventory.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  // 照類型分類、插入分類標題；同一頁裡類型一換就插新標題，武器/防具/飾品優先顯示在前面幾頁
  const lines: string[] = [];
  let lastType: string | null = null;
  for (const row of pageItems) {
    if (row.item.type !== lastType) {
      lastType = row.item.type;
      const headerEmoji = TYPE_EMOJIS[row.item.type] ?? "🧳";
      const headerLabel = TYPE_LABELS[row.item.type] ?? row.item.type;
      lines.push(`${headerEmoji}｜${headerLabel}`);
    }

    const isEquipped = row.kind === "instance" && row.equippedSlot !== null;
    const equippedTag = isEquipped ? "（裝備中）" : "";
    // 已經裝備中的道具不用跟自己比較，直接顯示原始數值就好，比較是給「還沒裝備的候選道具」參考用的；
    // 比較用的是算過強化的實際數值，不然 +7 的候選裝備會被當成 +0 來比
    const comparison =
      row.kind === "instance" && !isEquipped
        ? `　${ItemService.computeEquipComparison(row.item.type, row.item, equipped, row.enhanceLevel)}`
        : "";
    lines.push(`　${entryLabel(row)}${equippedTag}${comparison}`);
  }
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
        label: entryLabel(row).slice(0, 100),
        value: entryKey(row),
        // 選單重繪時要標記目前選的是哪個，不然畫面會跳回「未選擇」，看不出下面的按鈕是對哪個道具生效
        default: entryKey(row) === selectedKey,
      }))
    );
  components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));

  return { embeds: [embed], components };
}

// 加減按鈕＋中間的確認鍵放同一排（Discord 一排最多 5 顆按鈕，剛好塞下）；
// 實際會用掉幾個由 ItemService.useItem 依「回滿血量所需」封頂，這裡的 qty 只是「最多想用幾個」。
// customId 帶的是「目前數量＋位移量」而不是預先算好的目標值——qty 接近上下限時 -5/-1（或 +1/+5）
// 夾出來的目標值可能一樣，直接把目標值編進 customId 會撞成重複 ID 被 Discord 整張卡片拒收；
// 改成帶位移量，實際目標值交給按下去之後的 handler 去夾，永遠不會撞
function buildUseQuantityRow(
  ownerId: string,
  page: number,
  itemName: string,
  qty: number,
  maxQty: number
): ActionRowBuilder<ButtonBuilder> {
  const atMin = qty <= 1;
  const atMax = qty >= maxQty;

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId("inv_use_qty", ownerId, String(page), itemName, String(qty), "-5"))
      .setLabel("-5")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atMin),
    new ButtonBuilder()
      .setCustomId(buildCustomId("inv_use_qty", ownerId, String(page), itemName, String(qty), "-1"))
      .setLabel("-1")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atMin),
    new ButtonBuilder()
      .setCustomId(buildCustomId("inv_use", ownerId, String(page), itemName, String(qty)))
      .setLabel(`使用 x${qty}`)
      .setEmoji("🧪")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildCustomId("inv_use_qty", ownerId, String(page), itemName, String(qty), "1"))
      .setLabel("+1")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atMax),
    new ButtonBuilder()
      .setCustomId(buildCustomId("inv_use_qty", ownerId, String(page), itemName, String(qty), "5"))
      .setLabel("+5")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atMax)
  );
}

// 跟 buildUseQuantityRow 同樣的道理：customId 帶「目前數量＋位移量」，不要把夾好的目標值直接編進去，
// 避免 qty 接近上下限時兩顆按鈕撞出同一個 customId 被 Discord 拒收。
// 預設數量＝可賣的最大值（等於「賣光」），可以用 -1/-5 往下調、保留幾個不賣
function buildSellQuantityRow(
  ownerId: string,
  page: number,
  itemName: string,
  qty: number,
  unitPrice: number,
  maxQty: number
): ActionRowBuilder<ButtonBuilder> {
  const atMin = qty <= 1;
  const atMax = qty >= maxQty;

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId("inv_sell_qty", ownerId, String(page), itemName, String(qty), "-5"))
      .setLabel("-5")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atMin),
    new ButtonBuilder()
      .setCustomId(buildCustomId("inv_sell_qty", ownerId, String(page), itemName, String(qty), "-1"))
      .setLabel("-1")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atMin),
    new ButtonBuilder()
      .setCustomId(buildCustomId("inv_sell", ownerId, String(page), itemName, String(qty)))
      .setLabel(`賣出 x${qty}（${unitPrice * qty} 金幣）`)
      .setEmoji("💰")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildCustomId("inv_sell_qty", ownerId, String(page), itemName, String(qty), "1"))
      .setLabel("+1")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atMax),
    new ButtonBuilder()
      .setCustomId(buildCustomId("inv_sell_qty", ownerId, String(page), itemName, String(qty), "5"))
      .setLabel("+5")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atMax)
  );
}

// 飾品欄都滿時不能悶著頭自動選一欄頂掉，要讓玩家自己指定換哪一欄，
// 所以這裡要另外查目前的裝備狀態，跟其他分支不一樣；
// 藥水的使用數量、賣出數量各自成一排（跟裝備按鈕分開，避免同一排塞不下）
async function buildItemActionRows(
  userInternalId: string,
  ownerId: string,
  page: number,
  entry: InventoryEntry,
  options: { useQty?: number; sellQty?: number } = {}
): Promise<ActionRowBuilder<ButtonBuilder>[]> {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const item = entry.item;

  // ── 裝備實體：裝備/換欄 + 賣掉「這一件」（不需要選數量，選單選的就是明確的某一件）──
  if (entry.kind === "instance") {
    const equipButtons: ButtonBuilder[] = [];
    const equipped = await ItemService.getEquipped(userInternalId);

    if (entry.equippedSlot === null) {
      const bySlot = ACCESSORY_SLOTS.map((slot) => equipped.find((e) => e.slot === slot)?.equipped ?? null);
      const accessorySlotsFull = item.type === "accessory" && bySlot.every((eq) => eq !== null);

      if (accessorySlotsFull) {
        // 飾品三欄都滿時不能悶著頭自動選一欄頂掉，要讓玩家自己指定換哪一欄
        ACCESSORY_SLOTS.forEach((slot, i) => {
          const eq = bySlot[i]!;
          equipButtons.push(
            new ButtonBuilder()
              .setCustomId(buildCustomId("inv_equip_slot", ownerId, String(page), entry.instanceId, slot))
              .setLabel(`換掉「${eq.item.name}${enhanceSuffix(eq.enhanceLevel)}」`.slice(0, 80))
              .setEmoji("🛡️")
              .setStyle(ButtonStyle.Primary)
          );
        });
      } else {
        equipButtons.push(
          new ButtonBuilder()
            .setCustomId(buildCustomId("inv_equip", ownerId, String(page), entry.instanceId))
            .setLabel("裝備")
            .setEmoji("🛡️")
            .setStyle(ButtonStyle.Primary)
        );
      }
    }

    if (equipButtons.length > 0) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...equipButtons));
    }

    const sellPrice = ItemService.getSellPricePerUnit(item);
    const isEquipped = entry.equippedSlot !== null;
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildCustomId("inv_sell_instance", ownerId, String(page), entry.instanceId))
          .setLabel(
            isEquipped
              ? "賣掉（裝備中，請先換裝）"
              : `賣掉這件（${Math.round(sellPrice * (1 + entry.enhanceLevel * 0.1))} 金幣）`
          )
          .setEmoji("💰")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(isEquipped)
      )
    );
    return rows;
  }

  // ── 可堆疊道具：藥水有使用數量列，全部都有賣出數量列 ──────────────
  if (item.type === "potion") {
    const useMaxQty = Math.max(1, Math.min(99, entry.quantity));
    const useQty = Math.min(Math.max(1, options.useQty ?? 1), useMaxQty);
    rows.push(buildUseQuantityRow(ownerId, page, item.name, useQty, useMaxQty));
  }

  const sellableQty = entry.quantity;
  const unitPrice = ItemService.getSellPricePerUnit(item);
  const sellQty = Math.min(Math.max(1, options.sellQty ?? sellableQty), sellableQty);
  rows.push(buildSellQuantityRow(ownerId, page, item.name, sellQty, unitPrice, sellableQty));

  return rows;
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

// inv_select（選定道具）跟 inv_use_qty/inv_sell_qty（調整數量）共用：重繪背包 + 該道具的動作按鈕
async function renderItemSelection(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  ownerId: string,
  page: number,
  selectedKey: string,
  options: { useQty?: number; sellQty?: number } = {}
) {
  const view = await buildInventoryView(
    interaction.user.id,
    ownerId,
    page,
    interaction.user.username,
    interaction.user.displayAvatarURL(),
    selectedKey
  );
  const user = await RPGService.findUserByDiscordId(interaction.user.id);
  if (user) {
    // 選單傳回來的 key：裝備是實體 id、可堆疊道具是名稱，用同一份背包資料反查是哪一筆
    const entries = await ItemService.getInventory(user.id);
    const entry = entries.find((e) => entryKey(e) === selectedKey);
    if (entry) {
      view.components.push(...(await buildItemActionRows(user.id, ownerId, page, entry, options)));
    }
  }
  await interaction.editReply(view);
}

export async function handleInventorySelect(interaction: StringSelectMenuInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const page = parseInt(args[0], 10);
  const selectedKey = interaction.values[0];

  await interaction.deferUpdate();
  try {
    await renderItemSelection(interaction, ownerId, page, selectedKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.editReply({ content: message, embeds: [], components: [] });
  }
}

// interactionCreate.ts 會把 "inv_use_qty:*" 的按鈕點擊導到這裡；只調整想用幾個、還沒真的使用
export async function handleInventoryUseQtyButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const [pageStr, itemName, currentQtyStr, deltaStr] = args;
  const page = parseInt(pageStr, 10);
  const nextQty = parseInt(currentQtyStr, 10) + parseInt(deltaStr, 10);

  await interaction.deferUpdate();
  try {
    await renderItemSelection(interaction, ownerId, page, itemName, { useQty: nextQty });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.editReply({ content: message, embeds: [], components: [] });
  }
}

// interactionCreate.ts 會把 "inv_sell_qty:*" 的按鈕點擊導到這裡；只調整想賣幾個、還沒真的賣出
export async function handleInventorySellQtyButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const [pageStr, itemName, currentQtyStr, deltaStr] = args;
  const page = parseInt(pageStr, 10);
  const nextQty = parseInt(currentQtyStr, 10) + parseInt(deltaStr, 10);

  await interaction.deferUpdate();
  try {
    await renderItemSelection(interaction, ownerId, page, itemName, { sellQty: nextQty });
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
  const [pageStr, instanceId] = args;
  const page = parseInt(pageStr, 10);

  await interaction.deferUpdate();
  try {
    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) throw new Error("找不到你的角色資料");
    await ItemService.equipItem(user.id, instanceId);
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
  const [pageStr, instanceId, slot] = args;
  const page = parseInt(pageStr, 10);

  await interaction.deferUpdate();
  try {
    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) throw new Error("找不到你的角色資料");
    await ItemService.equipItem(user.id, instanceId, slot as EquipSlot);
    await refreshInventoryView(interaction, ownerId, page);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.followUp({ content: `裝備失敗：${message}`, flags: MessageFlags.Ephemeral });
  }
}

export async function handleInventoryUseButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const [pageStr, itemName, qtyStr] = args;
  const page = parseInt(pageStr, 10);
  const qty = Math.max(1, parseInt(qtyStr, 10) || 1);

  await interaction.deferUpdate();
  try {
    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) throw new Error("找不到你的角色資料");
    const { item, healedAmount, newHealth, maxHealth, usedAmount, requestedAmount } = await ItemService.useItem(
      user.id,
      itemName,
      qty
    );
    await refreshInventoryView(interaction, ownerId, page);

    const wasteNote =
      usedAmount < requestedAmount
        ? `（已回滿生命值，只用了 ${usedAmount} 個，其餘 ${requestedAmount - usedAmount} 個沒有浪費）`
        : "";
    await interaction.followUp({
      content: `🧪 使用了「${item.name}」x${usedAmount}${wasteNote}，恢復了 ${healedAmount} 點生命值！目前生命值：${newHealth}/${maxHealth}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.followUp({ content: `使用失敗：${message}`, flags: MessageFlags.Ephemeral });
  }
}

export async function handleInventorySellButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const [pageStr, itemName, qtyStr] = args;
  const page = parseInt(pageStr, 10);
  const qty = Math.max(1, parseInt(qtyStr, 10) || 1);

  await interaction.deferUpdate();
  try {
    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) throw new Error("找不到你的角色資料");
    const { item, sellPrice, amount, goldAfter } = await ItemService.sellItem(user.id, itemName, qty);
    await refreshInventoryView(interaction, ownerId, page);
    await interaction.followUp({
      content: `💰 賣掉「${item.name}」x${amount}，獲得 ${sellPrice} 金幣（目前 ${goldAfter} 金幣）。`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.followUp({ content: `販賣失敗：${message}`, flags: MessageFlags.Ephemeral });
  }
}

// interactionCreate.ts 會把 "inv_sell_instance:*" 的按鈕點擊導到這裡。
// 裝備一件一列，選單選中的就是明確的那一件，所以不像可堆疊道具還要再選數量
export async function handleInventorySellInstanceButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const [pageStr, instanceId] = args;
  const page = parseInt(pageStr, 10);

  await interaction.deferUpdate();
  try {
    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) throw new Error("找不到你的角色資料");
    const { item, enhanceLevel, sellPrice, goldAfter } = await ItemService.sellInstance(user.id, instanceId);
    await refreshInventoryView(interaction, ownerId, page);
    await interaction.followUp({
      content: `💰 賣掉「${item.name}${enhanceSuffix(enhanceLevel)}」，獲得 ${sellPrice} 金幣（目前 ${goldAfter} 金幣）。`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.followUp({ content: `販賣失敗：${message}`, flags: MessageFlags.Ephemeral });
  }
}
