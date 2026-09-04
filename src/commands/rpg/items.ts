import {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  MessageFlags,
} from "discord.js";
import { RPGService } from "../../services/rpgService";
import { ItemService } from "../../services/itemService";
import type { InventoryEntry } from "../../services/itemService";

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
    const amount = interaction.options.getInteger("amount") ?? 1;
    const { item, healedAmount, newHealth, maxHealth, usedAmount, requestedAmount } = await ItemService.useItem(
      user.id,
      itemName,
      amount
    );

    const wasteNote =
      usedAmount < requestedAmount
        ? `（已回滿生命值，只用了 ${usedAmount} 個，其餘 ${requestedAmount - usedAmount} 個沒有浪費）`
        : "";

    return interaction.editReply(
      `🧪 使用了「${item.name}」x${usedAmount}${wasteNote}，恢復了 ${healedAmount} 點生命值！目前生命值：${newHealth}/${maxHealth}`
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

  // 藥水一定是可堆疊的那一種（裝備才會是一件一列的實體）；
  // 用型別述詞讓 TS 知道篩完之後只剩 stack，才拿得到 quantity
  const inventory = await ItemService.getInventory(user.id);
  const filtered = inventory
    .filter(
      (row): row is Extract<InventoryEntry, { kind: "stack" }> =>
        row.kind === "stack" && row.item.type === "potion" && row.item.name.includes(focused)
    )
    .slice(0, 25);

  return interaction.respond(
    filtered.map((row) => ({
      name: `${row.item.name}（庫存 ${row.quantity} 個，預設使用 1 個，可用 amount 選項調整）`.slice(0, 100),
      value: row.item.name,
    }))
  );
}
