import { ButtonInteraction, StringSelectMenuInteraction, MessageFlags } from "discord.js";

// customId 格式固定是 "<prefix>:<ownerId>:<...args>"，不用額外的記憶體狀態，
// 重開機也不會讓按鈕/選單失效——資料本來就是即時查資料庫
export function parseCustomId(customId: string): {
  prefix: string;
  ownerId: string;
  args: string[];
} {
  const [prefix, ownerId, ...args] = customId.split(":");
  return { prefix, ownerId, args };
}

export function buildCustomId(prefix: string, ownerId: string, ...args: string[]): string {
  return [prefix, ownerId, ...args].join(":");
}

// 確認點按鈕/選單的人就是當初下指令的人，不是的話擋掉並回覆提示
export async function requireInteractionOwner(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  ownerId: string
): Promise<boolean> {
  if (interaction.user.id === ownerId) return true;
  await interaction.reply({
    content: "這不是你的操作，無法使用這個按鈕/選單。",
    flags: MessageFlags.Ephemeral,
  });
  return false;
}
