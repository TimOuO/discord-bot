import {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  MessageFlags,
} from "discord.js";
import { RPGService } from "../../services/rpgService";
import { ItemService, SLOT_GROUP_LABELS } from "../../services/itemService";
import type { EquipSlot } from "../../services/itemService";

const EQUIPPABLE_TYPES = ["weapon", "armor", "accessory"];

export async function handleEquipCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) {
      return interaction.editReply(
        "你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！"
      );
    }

    const itemName = interaction.options.getString("item", true);
    const preferredSlot = interaction.options.getString("slot") as EquipSlot | null;
    const { item, slot, replacedItem } = await ItemService.equipItem(
      user.id,
      itemName,
      preferredSlot ?? undefined
    );

    const slotLabel = SLOT_GROUP_LABELS[slot];
    if (replacedItem) {
      return interaction.editReply(
        `✅ ${slotLabel}已換成「${item.name}」（原本的「${replacedItem.name}」已卸下，還在背包裡）。`
      );
    }
    return interaction.editReply(`✅ 已將「${item.name}」裝備為${slotLabel}。`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`裝備失敗：${message}`);
  }
}

export async function equipAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused().trim();

  const user = await RPGService.findUserByDiscordId(interaction.user.id);
  if (!user) return interaction.respond([]);

  const inventory = await ItemService.getInventory(user.id);
  const filtered = inventory
    .filter(
      (row) =>
        EQUIPPABLE_TYPES.includes(row.item.type) && row.item.name.includes(focused)
    )
    .slice(0, 25);

  return interaction.respond(
    filtered.map((row) => ({
      name: `${row.item.name} x${row.quantity}`,
      value: row.item.name,
    }))
  );
}

export async function handleUseCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) {
      return interaction.editReply(
        "你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！"
      );
    }

    const itemName = interaction.options.getString("item", true);
    const { item, healedAmount, newHealth, maxHealth } = await ItemService.useItem(
      user.id,
      itemName
    );

    return interaction.editReply(
      `🧪 使用了「${item.name}」，恢復了 ${healedAmount} 點生命值！目前生命值：${newHealth}/${maxHealth}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`使用失敗：${message}`);
  }
}

export async function useAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused().trim();

  const user = await RPGService.findUserByDiscordId(interaction.user.id);
  if (!user) return interaction.respond([]);

  const inventory = await ItemService.getInventory(user.id);
  const filtered = inventory
    .filter((row) => row.item.type === "potion" && row.item.name.includes(focused))
    .slice(0, 25);

  return interaction.respond(
    filtered.map((row) => ({
      name: `${row.item.name} x${row.quantity}`,
      value: row.item.name,
    }))
  );
}
