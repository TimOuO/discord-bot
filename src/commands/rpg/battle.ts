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

function buildBattleRematchRow(ownerId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`battle_rematch:${ownerId}`)
      .setLabel("再戰一次")
      .setEmoji("⚔️")
      .setStyle(ButtonStyle.Primary)
  );
}

// /rpg battle 首次執行、跟「再戰一次」按鈕都呼叫這個，確保卡片長得一模一樣
async function runBattleAndBuildReply(userId: string, username: string, avatarURL: string) {
  const battleResult = await RPGService.battle(userId);
  const color = battleResult.result === "win" ? "#2ecc71" : "#e74c3c";

  const embed = new EmbedBuilder()
    .setAuthor({ name: username, iconURL: avatarURL })
    .setTitle(`⚔️ ${username} vs ${battleResult.enemyName} Lv.${battleResult.enemyLevel}`)
    .setDescription(battleResult.message)
    .setColor(color as ColorResolvable)
    .addFields(
      sectionField("📊", "目前狀態", [
        `等級 ${chip(battleResult.user.level)}（經驗 ${chip(`${battleResult.user.xp}/${xpThresholdForLevel(battleResult.user.level)}`)}）`,
        `生命值 ${progressBar(battleResult.user.health, battleResult.effectiveMaxHealth)} ${chip(`${battleResult.user.health}/${battleResult.effectiveMaxHealth}`)}（${battleResult.healthDelta >= 0 ? "+" : ""}${chip(battleResult.healthDelta)}・共 ${chip(battleResult.rounds)} 回合）`,
        `金幣 ${chip(battleResult.user.gold)}`,
      ])
    );

  embed.setFooter({ text: battleResult.result === "win" ? "恭喜獲勝！" : "不幸失敗，休息一下再來吧！" });

  return { embeds: [embed], components: [buildBattleRematchRow(userId)] };
}

export async function handleBattleCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();

    try {
      const payload = await runBattleAndBuildReply(
        interaction.user.id,
        interaction.user.username,
        interaction.user.displayAvatarURL()
      );
      return interaction.editReply(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return interaction.editReply(message);
    }
  } catch (error) {
    console.error("Battle 命令錯誤:", error);
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`戰鬥失敗: ${message}`);
  }
}

// interactionCreate.ts 會把 "battle_rematch:*" 的按鈕點擊導到這裡
// 發新訊息、不動原本那張卡片：改成原地編輯的話，卡片不會因為被編輯跳到頻道最下面，
// 頻道一有其他訊息穿插進來就容易被埋掉、找不到
export async function handleBattleRematchButton(interaction: ButtonInteraction) {
  const { ownerId } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;

  await interaction.deferReply();
  try {
    const payload = await runBattleAndBuildReply(
      interaction.user.id,
      interaction.user.username,
      interaction.user.displayAvatarURL()
    );
    await interaction.editReply(payload);
  } catch (error) {
    // 失敗（例如冷卻中）不留下一則公開的空白/錯誤訊息，刪掉 placeholder 改成只有本人看得到的提示
    await interaction.deleteReply();
    const message = error instanceof Error ? error.message : String(error);
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  }
}
