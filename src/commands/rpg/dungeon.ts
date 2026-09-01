import {
  ChatInputCommandInteraction,
  ButtonInteraction,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ColorResolvable,
  MessageFlags,
} from "discord.js";
import { RPGService, xpThresholdForLevel } from "../../services/rpgService";
import { parseCustomId, requireInteractionOwner } from "../../utils/interactions";
import { sectionField, chip, progressBar } from "../../utils/embeds";

function buildDungeonRetryRow(ownerId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`dungeon_retry:${ownerId}`)
      .setLabel("再次挑戰")
      .setEmoji("🏰")
      .setStyle(ButtonStyle.Primary)
  );
}

// /rpg dungeon 首次執行、跟「再次挑戰」按鈕都呼叫這個，確保卡片長得一模一樣
async function runDungeonAndBuildReply(userId: string, username: string, avatarURL: string) {
  const result = await RPGService.dungeon(userId);

  if (result.status === "not_started") {
    throw new Error("你尚未開始 RPG 冒險。請先使用 /rpg start 命令開始遊戲！");
  }
  if (result.status === "cooldown") {
    throw new Error(`地下城還沒重置，請等待 ${result.remainingSeconds} 秒後再挑戰`);
  }

  const floorLines = result.floors.map((floor) => {
    const outcome = floor.result === "win" ? "✅ 勝利" : "❌ 落敗";
    const emoji = floor.floor === 4 ? "🏆" : "⚔️";
    const rareLootNote = floor.rareLoot ? `\n　└ ✨ 額外掉落了稀有材料「${floor.rareLoot.item.name}」！` : "";
    return `${emoji} 第 ${floor.floor} 層：${floor.enemyName} Lv.${floor.enemyLevel} → ${outcome}（${chip(floor.rounds)} 回合）${rareLootNote}`;
  });

  const rewardLines = [
    `經驗值 +${chip(result.totalXpGained)}${result.completionBonusXp > 0 ? `（含全通關 +${result.completionBonusXp}）` : ""}`,
    `金幣 +${chip(result.totalGoldGained)}${result.completionBonusGold > 0 ? `（含全通關 +${result.completionBonusGold}）` : ""}`,
  ];

  const description = result.clearedAllFloors
    ? "恭喜！你完全征服了地下城！"
    : `你在第 ${result.floors.length} 層落敗，鎩羽而歸……不過已過的關卡獎勵都保留下來了。`;

  const embed = new EmbedBuilder()
    .setAuthor({ name: username, iconURL: avatarURL })
    .setTitle("🏰 地下城挑戰")
    .setDescription(description)
    .setColor((result.clearedAllFloors ? "#f1c40f" : "#e74c3c") as ColorResolvable)
    .addFields(
      sectionField("📜", "戰鬥記錄", floorLines),
      sectionField("🎁", "獲得獎勵", rewardLines),
      sectionField("📊", "目前狀態", [
        `等級 ${chip(result.user.level)}（經驗 ${chip(`${result.user.xp}/${xpThresholdForLevel(result.user.level)}`)}）`,
        `生命值 ${progressBar(result.user.health, result.effectiveMaxHealth)} ${chip(`${result.user.health}/${result.effectiveMaxHealth}`)}`,
        `金幣 ${chip(result.user.gold)}`,
      ])
    );

  return { embeds: [embed], components: [buildDungeonRetryRow(userId)] };
}

export async function handleDungeonCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();
    const payload = await runDungeonAndBuildReply(
      interaction.user.id,
      interaction.user.username,
      interaction.user.displayAvatarURL()
    );
    return interaction.editReply(payload);
  } catch (error) {
    console.error("Dungeon 命令錯誤:", error);
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`挑戰失敗：${message}`);
  }
}

// interactionCreate.ts 會把 "dungeon_retry:*" 的按鈕點擊導到這裡
// 發新訊息、不動原本那張卡片：跟 battle 的「再戰一次」同樣的道理，編輯原地不會把卡片頂到頻道最下面
export async function handleDungeonRetryButton(interaction: ButtonInteraction) {
  const { ownerId } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;

  await interaction.deferReply();
  try {
    const payload = await runDungeonAndBuildReply(
      interaction.user.id,
      interaction.user.username,
      interaction.user.displayAvatarURL()
    );
    await interaction.editReply(payload);
  } catch (error) {
    await interaction.deleteReply();
    const message = error instanceof Error ? error.message : String(error);
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  }
}
