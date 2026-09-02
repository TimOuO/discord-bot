import {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
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
  RARITY_LABELS,
  SLOT_GROUP_LABELS,
  TYPE_EMOJIS,
  TYPE_LABELS,
  formatEffectValue,
} from "../../services/itemService";
import type { RecipeIngredient } from "../../services/itemService";
import type { Item } from "../../generated/prisma";
import { chip, sectionField } from "../../utils/embeds";
import { buildCustomId, parseCustomId, requireInteractionOwner } from "../../utils/interactions";

const PAGE_SIZE = 5;

// 鍛造成功後回傳的卡片，direct 指令（/rpg craft item:X）跟清單頁的按鈕都共用
async function replyCraftSuccess(
  discordUserId: string,
  itemName: string
): Promise<{ embeds: EmbedBuilder[] }> {
  const user = await RPGService.findUserByDiscordId(discordUserId);
  if (!user) throw new Error("你尚未開始 RPG 冒險，請先使用 /rpg start 命令開始遊戲！");

  const { item, quantity, autoEquippedSlot } = await ItemService.craftItem(user.id, itemName);

  const rarityLabel = RARITY_LABELS[item.rarity] ?? item.rarity;
  const recipe = (item.recipe as unknown as RecipeIngredient[]) ?? [];
  const equipNote = autoEquippedSlot ? `，並自動裝備為${SLOT_GROUP_LABELS[autoEquippedSlot]}！` : "";
  const effects = getItemEffects(item);

  const embed = new EmbedBuilder()
    .setTitle("🔨 鍛造成功！")
    .setColor("#e67e22" as ColorResolvable)
    .setDescription(
      [
        `▷ 鍛造出「${item.name}」（${rarityLabel}）${equipNote}`,
        `▷ 效果：${effects.join("、")}`,
        `▷ 目前擁有 ${chip(quantity)} 個`,
      ].join("\n")
    )
    .addFields(
      sectionField(
        "📜",
        "消耗材料",
        recipe.map((ingredient) => `${ingredient.itemName} x${chip(ingredient.quantity)}`)
      )
    );

  return { embeds: [embed] };
}

export async function handleCraftCommand(interaction: ChatInputCommandInteraction) {
  const itemName = interaction.options.getString("item");

  // 沒指定要鍛造的道具：顯示可瀏覽的配方清單，而不是直接報錯
  if (!itemName) {
    const view = await buildCraftListView(interaction.user.id, interaction.user.id, 0);
    return interaction.reply(view);
  }

  try {
    await interaction.deferReply();
    const payload = await replyCraftSuccess(interaction.user.id, itemName);
    return interaction.editReply(payload);
  } catch (error) {
    console.error("RPG Craft 命令錯誤:", error);
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`鍛造失敗：${message}`);
  }
}

// 材料「現有/需要」逐項比對，回傳整體能不能鍛造，跟每項材料的 have/need 文字；
// 清單頁的卡片、自動完成的下拉建議都共用同一份判斷邏輯，不用各寫一次容易兜不起來
function getRecipeStatus(
  item: Item,
  ownedByName: Map<string, number>
): { canCraft: boolean; parts: string[] } {
  const recipe = (item.recipe as unknown as RecipeIngredient[]) ?? [];
  let canCraft = true;
  const parts = recipe.map((ingredient) => {
    const owned = ownedByName.get(ingredient.itemName) ?? 0;
    const ok = owned >= ingredient.quantity;
    if (!ok) canCraft = false;
    return `${ingredient.itemName}${owned}/${ingredient.quantity}${ok ? "✅" : "❌"}`;
  });
  return { canCraft, parts };
}

function getItemEffects(item: Item): string[] {
  const effects = [formatEffectValue(item.effectType, item.effectValue)];
  if (item.effectType2 && item.effectValue2 != null) {
    effects.push(formatEffectValue(item.effectType2, item.effectValue2));
  }
  return effects;
}

async function getOwnedByName(discordUserId: string): Promise<Map<string, number>> {
  const user = await RPGService.findUserByDiscordId(discordUserId);
  if (!user) return new Map();
  const inventory = await ItemService.getInventory(user.id);
  return new Map(inventory.map((row) => [row.item.name, row.quantity]));
}

// 自動完成的下拉選單直接標出材料夠不夠，不用先送出指令才知道能不能做
export async function craftAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused().trim();
  const items = await ItemService.getCraftableCatalog();
  const filtered = items.filter((item) => item.name.includes(focused)).slice(0, 25);
  const ownedByName = await getOwnedByName(interaction.user.id);

  return interaction.respond(
    filtered.map((item) => {
      const { canCraft, parts } = getRecipeStatus(item, ownedByName);
      const statusEmoji = canCraft ? "✅" : "❌";
      const effects = getItemEffects(item).join("、");
      // 數值在第一行、材料需求在第二行，分層比較好一眼看懂；Discord 自動完成選項上限 100 字元
      const name = `${statusEmoji} ${item.name}（${effects}）\n${parts.join("、")}`;
      return {
        name: name.slice(0, 100),
        value: item.name,
      };
    })
  );
}

type CraftListView = {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
};

// 每個配方旁邊直接列出材料「現有/需要」跟 ✅/❌，不用先鍛造一次才知道自己缺什麼；
// 數值改成跟目前裝備比較（神話裝備全部都是可裝備類型），不只是顯示原始效果
function formatRecipeLine(
  item: Item,
  ownedByName: Map<string, number>,
  equipped: Awaited<ReturnType<typeof ItemService.getEquipped>>
): string {
  const rarityLabel = RARITY_LABELS[item.rarity] ?? item.rarity;
  const effectText = ItemService.computeEquipComparison(item.type, item, equipped);

  const { canCraft, parts } = getRecipeStatus(item, ownedByName);
  const statusEmoji = canCraft ? "✅" : "❌";
  return [
    `${statusEmoji} **${item.name}**（${rarityLabel}・${effectText}）`,
    `　需要：${parts.join("、")}`,
  ].join("\n");
}

// 不用記憶體存分頁狀態，customId 直接帶頁碼，資料每次都即時查，機器人重啟也不會讓按鈕失效；
// 配方清單本身是公開資訊（誰都能看），但只有當初下指令的人（ownerId）能操作按鈕/選單
async function buildCraftListView(
  discordUserId: string,
  ownerId: string,
  page: number,
  selectedItemName?: string
): Promise<CraftListView> {
  const items = await ItemService.getCraftableCatalog();
  const ownedByName = await getOwnedByName(discordUserId);
  const user = await RPGService.findUserByDiscordId(discordUserId);
  const equipped = user ? await ItemService.getEquipped(user.id) : [];

  const embed = new EmbedBuilder()
    .setTitle("🔨 鍛造配方")
    .setColor("#e67e22" as ColorResolvable);

  const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

  if (items.length === 0) {
    embed.addFields(sectionField("🔨", "配方", ["目前沒有可以鍛造的裝備"]));
    return { embeds: [embed], components };
  }

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(0, page), totalPages - 1);
  const pageItems = items.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  // 照類型分類、插入分類標題；同一頁裡類型一換就插新標題
  const lines: string[] = [];
  let lastType: string | null = null;
  for (const item of pageItems) {
    if (item.type !== lastType) {
      lastType = item.type;
      const headerEmoji = TYPE_EMOJIS[item.type] ?? "🔨";
      const headerLabel = TYPE_LABELS[item.type] ?? item.type;
      lines.push(`${headerEmoji}｜${headerLabel}`);
    }
    lines.push(formatRecipeLine(item, ownedByName, equipped));
  }
  embed.addFields(sectionField("🔨", `配方（第 ${clampedPage + 1}/${totalPages} 頁）`, lines));
  embed.setFooter({ text: "選單選裝備後，材料夠的話可以直接鍛造" });

  if (totalPages > 1) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildCustomId("craft_page", ownerId, String(clampedPage - 1)))
          .setLabel("◀ 上一頁")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(clampedPage === 0),
        new ButtonBuilder()
          .setCustomId(buildCustomId("craft_page", ownerId, String(clampedPage + 1)))
          .setLabel("下一頁 ▶")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(clampedPage === totalPages - 1)
      )
    );
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId("craft_select", ownerId, String(clampedPage)))
    .setPlaceholder("選一件裝備來鍛造")
    .addOptions(
      pageItems.map((item) => ({
        label: item.name,
        value: item.name,
        default: item.name === selectedItemName,
      }))
    );
  components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));

  return { embeds: [embed], components };
}

function buildCraftButtonRow(ownerId: string, page: number, itemName: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId("craft_make", ownerId, String(page), itemName))
      .setLabel("鍛造")
      .setEmoji("🔨")
      .setStyle(ButtonStyle.Primary)
  );
}

export async function handleCraftListPageButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const page = parseInt(args[0], 10);

  await interaction.deferUpdate();
  const view = await buildCraftListView(interaction.user.id, ownerId, page);
  await interaction.editReply(view);
}

export async function handleCraftListSelect(interaction: StringSelectMenuInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const page = parseInt(args[0], 10);
  const itemName = interaction.values[0];

  await interaction.deferUpdate();
  const view = await buildCraftListView(interaction.user.id, ownerId, page, itemName);
  view.components.push(buildCraftButtonRow(ownerId, page, itemName));
  await interaction.editReply(view);
}

// interactionCreate.ts 會把 "craft_make:*" 的按鈕點擊導到這裡
export async function handleCraftMakeButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const [pageStr, itemName] = args;
  const page = parseInt(pageStr, 10);

  await interaction.deferUpdate();
  try {
    const payload = await replyCraftSuccess(interaction.user.id, itemName);

    // 鍛造完回到清單瀏覽狀態（跟 shop 的快捷購買一致），材料有沒有變化清單上會直接看到
    const view = await buildCraftListView(interaction.user.id, ownerId, page);
    await interaction.editReply(view);
    await interaction.followUp({ content: "🔨 鍛造成功！", flags: MessageFlags.Ephemeral, embeds: payload.embeds });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.followUp({ content: `鍛造失敗：${message}`, flags: MessageFlags.Ephemeral });
  }
}
