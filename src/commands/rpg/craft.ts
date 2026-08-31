import {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
  ColorResolvable,
} from "discord.js";
import { RPGService } from "../../services/rpgService";
import { ItemService, RARITY_LABELS, SLOT_GROUP_LABELS, formatEffectValue } from "../../services/itemService";
import type { RecipeIngredient } from "../../services/itemService";
import { chip, sectionField } from "../../utils/embeds";

export async function handleCraftCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();

    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) {
      return interaction.editReply(
        "你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！"
      );
    }

    const itemName = interaction.options.getString("item", true);
    const { item, quantity, autoEquippedSlot } = await ItemService.craftItem(user.id, itemName);

    const rarityLabel = RARITY_LABELS[item.rarity] ?? item.rarity;
    const recipe = (item.recipe as unknown as RecipeIngredient[]) ?? [];
    const equipNote = autoEquippedSlot
      ? `，並自動裝備為${SLOT_GROUP_LABELS[autoEquippedSlot]}！`
      : "";
    const effects = [formatEffectValue(item.effectType, item.effectValue)];
    if (item.effectType2 && item.effectValue2 != null) {
      effects.push(formatEffectValue(item.effectType2, item.effectValue2));
    }

    const embed = new EmbedBuilder()
      .setAuthor({
        name: interaction.user.username,
        iconURL: interaction.user.displayAvatarURL(),
      })
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

    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("RPG Craft 命令錯誤:", error);
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`鍛造失敗：${message}`);
  }
}

export async function craftAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused().trim();
  const items = await ItemService.getCraftableCatalog();
  const filtered = items.filter((item) => item.name.includes(focused)).slice(0, 25);

  return interaction.respond(
    filtered.map((item) => {
      const recipe = (item.recipe as unknown as RecipeIngredient[]) ?? [];
      const recipeSummary = recipe.map((ingredient) => `${ingredient.quantity}x${ingredient.itemName}`).join("、");
      return {
        name: `${item.name}（${recipeSummary}）`.slice(0, 100),
        value: item.name,
      };
    })
  );
}
