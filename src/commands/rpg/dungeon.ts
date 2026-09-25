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
import { RPGService, DUNGEON_COOLDOWN_MS } from "../../services/rpgService";
import type {
  DungeonEnterResult,
  DungeonClearedFloor,
  PendingLoot,
} from "../../services/rpgService";
import { AFFIX_LABELS, AFFIX_DESCRIPTIONS } from "../../services/dungeonRun";
import { PlayerNotice, describeCommandError } from "../../utils/errors";
import { formatCooldown } from "../../utils/datetime";
import { buildCustomId, parseCustomId, requireInteractionOwner } from "../../utils/interactions";
import { sectionField, chip, progressBar } from "../../utils/embeds";

/** 一次自動突破太多層時，摘要只列最後這幾層——前面的都是碾過去的，不值得佔版面 */
const MAX_SUMMARY_FLOORS = 6;

function describeEnemy(enemyName: string, enemyLevel: number, affix: string | null): string {
  if (!affix) return `${enemyName} Lv.${enemyLevel}`;
  const label = AFFIX_LABELS[affix as keyof typeof AFFIX_LABELS] ?? affix;
  const desc = AFFIX_DESCRIPTIONS[affix as keyof typeof AFFIX_DESCRIPTIONS] ?? "";
  return `${enemyName} Lv.${enemyLevel}【${label}】${desc}`;
}

function summariseFloors(floors: DungeonClearedFloor[]): string[] {
  if (floors.length === 0) return [];
  const shown = floors.slice(-MAX_SUMMARY_FLOORS);
  const lines = shown.map((f) => {
    const material = f.materialName ? ` ✨「${f.materialName}」` : "";
    return `第 ${f.floor} 層 ✓ ${describeEnemy(f.enemyName, f.enemyLevel, f.affix)}（${f.rounds} 回合）${material}`;
  });
  if (floors.length > shown.length) {
    lines.unshift(`…前 ${floors.length - shown.length} 層已自動突破`);
  }
  return lines;
}

function describeLoot(loot: PendingLoot[]): string {
  if (loot.length === 0) return "（無）";
  return loot.map((l) => `${l.name}${l.quantity > 1 ? ` x${l.quantity}` : ""}`).join("、");
}

function buildDecisionRow(
  ownerId: string,
  survivalPercent: number
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId("dungeon_descend", ownerId))
      .setLabel(`繼續下潛（存活率 ${survivalPercent}%）`)
      .setEmoji("⬇️")
      // 存活率低於一半就不要用綠色慫恿玩家，讓按鈕本身就帶著警告
      .setStyle(survivalPercent >= 50 ? ButtonStyle.Primary : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(buildCustomId("dungeon_leave", ownerId))
      .setLabel("帶著戰利品離開")
      .setEmoji("💰")
      .setStyle(ButtonStyle.Success)
  );
}

/**
 * 一趟結束（帶著離開或戰敗）之後的「再次挑戰」。
 * 跟其他重試按鈕一樣把冷卻標在標籤上——按得下去，太早按就給提示而不是錯誤。
 */
function buildDungeonAgainRow(ownerId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId("dungeon_again", ownerId))
      .setLabel(`再次挑戰（冷卻 ${formatCooldown(DUNGEON_COOLDOWN_MS)}）`)
      .setEmoji("🏰")
      .setStyle(ButtonStyle.Primary)
  );
}

/** 停在決策點的卡片：把這次自動打過的層、目前未入袋的東西、下一層的風險全部攤開 */
function buildDecisionReply(
  username: string,
  avatarURL: string,
  ownerId: string,
  result: Extract<DungeonEnterResult, { status: "at_decision" }>
) {
  const survivalPercent = Math.round(result.survival * 100);
  const next = result.nextFloor;

  const embed = new EmbedBuilder()
    .setAuthor({ name: username, iconURL: avatarURL })
    .setTitle(`🏰 地下城 — 已下潛 ${result.clearedFloors} 層`)
    .setColor((survivalPercent >= 50 ? "#e67e22" : "#e74c3c") as ColorResolvable);

  const summary = summariseFloors(result.autoCleared);
  if (summary.length > 0) {
    embed.addFields(sectionField("⚔️", "這一段的戰況", summary));
  }

  embed.addFields(
    sectionField("📊", "目前狀態", [
      `血量 ${progressBar(result.health, result.maxHealth)} ${chip(`${result.health}/${result.maxHealth}`)}`,
    ]),
    // 「未入袋」三個字要一直在玩家眼前：那是他正在拿來賭的東西
    sectionField("🎒", "未入袋的戰利品（戰敗全部沒收）", [
      `金幣 ${chip(result.goldPending)}`,
      `經驗 ${chip(result.xpPending)}（經驗不會沒收）`,
      `材料 ${describeLoot(result.lootPending)}`,
    ]),
    sectionField(
      "⚠️",
      `第 ${next.floor} 層`,
      [
        describeEnemy(next.enemy.name, next.enemy.level, next.affix),
        `存活率 ${chip(`${survivalPercent}%`)}`,
        next.givesMaterial ? "打贏這層會多拿一件稀有材料" : "",
      ].filter(Boolean)
    )
  );

  embed.setFooter({ text: "沒帶走的東西戰敗就沒了；離開之後要等冷卻才能再進來" });

  return { embeds: [embed], components: [buildDecisionRow(ownerId, survivalPercent)] };
}

function buildDeathReply(
  username: string,
  avatarURL: string,
  ownerId: string,
  result: Extract<DungeonEnterResult, { status: "died" }>
) {
  const embed = new EmbedBuilder()
    .setAuthor({ name: username, iconURL: avatarURL })
    .setTitle(`💀 倒在第 ${result.deathFloor.floor} 層`)
    .setColor("#992d22" as ColorResolvable)
    .setDescription(
      `敗給了 ${describeEnemy(result.deathFloor.enemy.name, result.deathFloor.enemy.level, result.deathFloor.affix)}。`
    );

  const summary = summariseFloors(result.autoCleared);
  if (summary.length > 0) {
    embed.addFields(sectionField("⚔️", "這一段的戰況", summary));
  }

  embed.addFields(
    sectionField("💀", "沒收的戰利品", [
      `金幣 ${chip(result.goldForfeited)}`,
      `材料 ${describeLoot(result.lootForfeited)}`,
    ]),
    sectionField("✨", "保住的東西", [`經驗 ${chip(result.xpGained)}`, "血量已回復成進場前的狀態"])
  );

  embed.setFooter({ text: `總共下潛了 ${result.clearedFloors} 層` });
  return { embeds: [embed], components: [buildDungeonAgainRow(ownerId)] };
}

async function buildReply(
  discordUserId: string,
  username: string,
  avatarURL: string,
  result: DungeonEnterResult | { status: "no_run" }
) {
  switch (result.status) {
    case "not_started":
      throw new PlayerNotice("你尚未開始 RPG 冒險。請先使用 /rpg start 命令開始遊戲！");
    case "cooldown":
      throw new PlayerNotice(
        `⏳ 地下城還在重置，還要等 ${formatCooldown(result.remainingSeconds * 1000)}。`
      );
    case "no_run":
      throw new PlayerNotice("你現在沒有正在進行的下潛，用 `/rpg dungeon` 開始新的一趟。");
    case "at_decision":
      return buildDecisionReply(username, avatarURL, discordUserId, result);
    case "died":
      return buildDeathReply(username, avatarURL, discordUserId, result);
  }
}

export async function handleDungeonCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();
    const result = await RPGService.dungeonEnter(interaction.user.id);
    const payload = await buildReply(
      interaction.user.id,
      interaction.user.username,
      interaction.user.displayAvatarURL(),
      result
    );
    return interaction.editReply(payload);
  } catch (error) {
    const message = describeCommandError("Dungeon 命令錯誤", error);
    return interaction.editReply(`挑戰失敗：${message}`);
  }
}

// 下潛/離開都是「原地更新同一張卡片」：一趟是連續的過程，
// 每按一次就在頻道多洗一則新訊息會把整趟的脈絡打散
async function handleRunButton(
  interaction: ButtonInteraction,
  run: (discordUserId: string) => Promise<DungeonEnterResult | { status: "no_run" }>,
  context: string
) {
  const { ownerId } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;

  await interaction.deferUpdate();
  try {
    const result = await run(interaction.user.id);
    const payload = await buildReply(
      interaction.user.id,
      interaction.user.username,
      interaction.user.displayAvatarURL(),
      result
    );
    await interaction.editReply(payload);
  } catch (error) {
    const message = describeCommandError(context, error);
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  }
}

// 開新的一趟會發新訊息、不動原本那張結算卡片：那張是「這趟的結果」，
// 被下一趟蓋掉的話玩家就看不到自己剛剛帶走了什麼
export async function handleDungeonAgainButton(interaction: ButtonInteraction) {
  const { ownerId } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;

  await interaction.deferReply();
  try {
    const result = await RPGService.dungeonEnter(interaction.user.id);
    const payload = await buildReply(
      interaction.user.id,
      interaction.user.username,
      interaction.user.displayAvatarURL(),
      result
    );
    await interaction.editReply(payload);
  } catch (error) {
    await interaction.deleteReply();
    const message = describeCommandError("地下城「再次挑戰」按鈕錯誤", error);
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  }
}

export async function handleDungeonDescendButton(interaction: ButtonInteraction) {
  return handleRunButton(interaction, (id) => RPGService.dungeonDescend(id), "地下城下潛按鈕錯誤");
}

export async function handleDungeonLeaveButton(interaction: ButtonInteraction) {
  const { ownerId } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;

  await interaction.deferUpdate();
  try {
    const result = await RPGService.dungeonLeave(interaction.user.id);
    if (result.status === "not_started") {
      throw new PlayerNotice("你尚未開始 RPG 冒險。請先使用 /rpg start 命令開始遊戲！");
    }
    if (result.status === "no_run") {
      throw new PlayerNotice("你現在沒有正在進行的下潛，用 `/rpg dungeon` 開始新的一趟。");
    }

    const embed = new EmbedBuilder()
      .setAuthor({
        name: interaction.user.username,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .setTitle(`💰 帶著戰利品離開地下城`)
      .setColor("#2ecc71" as ColorResolvable)
      .setDescription(`在第 ${result.clearedFloors} 層見好就收。`)
      .addFields(
        sectionField("🎒", "入袋", [
          `金幣 ${chip(result.goldGained)}`,
          `經驗 ${chip(result.xpGained)}`,
          `材料 ${describeLoot(result.loot)}`,
        ])
      )
      .setFooter({
        text: `目前金幣 ${result.user.gold}・冷卻 ${formatCooldown(DUNGEON_COOLDOWN_MS)}`,
      });

    await interaction.editReply({
      embeds: [embed],
      components: [buildDungeonAgainRow(ownerId)],
    });
  } catch (error) {
    const message = describeCommandError("地下城離開按鈕錯誤", error);
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  }
}
