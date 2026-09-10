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
import { RPGService } from "../../services/rpgService";
import {
  JOB_KEYS,
  JOB_LABELS,
  JOB_SYSTEMS,
  JOB_DESCRIPTIONS,
  JOB_UNLOCK_LEVEL,
  JOB_CHANGE_COST,
  isJobKey,
  type JobKey,
} from "../../services/jobs";
import { PlayerNotice, describeCommandError } from "../../utils/errors";
import { buildCustomId, parseCustomId, requireInteractionOwner } from "../../utils/interactions";
import { sectionField } from "../../utils/embeds";

/** 目前上線的職業。血戰鬥神的連戰要跨請求狀態，排在第二階段，所以先不開放 */
const AVAILABLE_JOBS: readonly JobKey[] = ["delver", "smith", "forager"];
const COMING_SOON: readonly JobKey[] = JOB_KEYS.filter((k) => !AVAILABLE_JOBS.includes(k));

function buildJobRows(ownerId: string, currentJob: JobKey | null): ActionRowBuilder<ButtonBuilder>[] {
  const buttons = AVAILABLE_JOBS.map((key) =>
    new ButtonBuilder()
      .setCustomId(buildCustomId("job_pick", ownerId, key))
      .setLabel(JOB_LABELS[key])
      .setStyle(key === currentJob ? ButtonStyle.Secondary : ButtonStyle.Primary)
      // 選目前這個職業沒有意義，直接停用，免得玩家白付一次變更費用
      .setDisabled(key === currentJob)
  );
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)];
}

async function buildJobView(discordUserId: string, ownerId: string, username: string, avatarURL: string) {
  const user = await RPGService.findUserByDiscordId(discordUserId);
  if (!user) {
    throw new PlayerNotice("你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！");
  }

  const currentJob = isJobKey(user.job) ? user.job : null;
  const unlocked = user.level >= JOB_UNLOCK_LEVEL;
  const nextCost = user.jobChangedOnce ? JOB_CHANGE_COST : 0;

  const embed = new EmbedBuilder()
    .setAuthor({ name: username, iconURL: avatarURL })
    .setTitle("🎖️ 職業殿堂")
    .setColor("#8e44ad" as ColorResolvable)
    .setDescription(
      currentJob
        ? `你目前的職業是 **${JOB_LABELS[currentJob]}**。`
        : unlocked
          ? "選一個職業。被動只會改變它負責的那個系統，選了之後其他三個系統維持原樣。"
          : `職業在 **Lv${JOB_UNLOCK_LEVEL}** 開放，你現在是 Lv${user.level}。`
    );

  embed.addFields(
    ...AVAILABLE_JOBS.map((key) =>
      sectionField(
        key === currentJob ? "✅" : "▫️",
        `${JOB_LABELS[key]}（${JOB_SYSTEMS[key]}）`,
        [JOB_DESCRIPTIONS[key]]
      )
    )
  );

  if (COMING_SOON.length > 0) {
    embed.addFields(
      ...COMING_SOON.map((key) =>
        sectionField("🔒", `${JOB_LABELS[key]}（${JOB_SYSTEMS[key]}）・準備中`, [
          JOB_DESCRIPTIONS[key],
        ])
      )
    );
  }

  embed.setFooter({
    text: unlocked
      ? nextCost === 0
        ? "第一次選擇免費"
        : `變更職業需要 ${nextCost} 金幣（你有 ${user.gold}）`
      : `再升 ${JOB_UNLOCK_LEVEL - user.level} 級就能選擇職業`,
  });

  return {
    embeds: [embed],
    components: unlocked ? buildJobRows(ownerId, currentJob) : [],
  };
}

export async function handleJobCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();
    const payload = await buildJobView(
      interaction.user.id,
      interaction.user.id,
      interaction.user.username,
      interaction.user.displayAvatarURL()
    );
    return interaction.editReply(payload);
  } catch (error) {
    const message = describeCommandError("RPG Job 命令錯誤", error);
    return interaction.editReply(`查看職業失敗：${message}`);
  }
}

export async function handleJobPickButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;
  const [jobKey] = args;

  await interaction.deferUpdate();
  try {
    if (!isJobKey(jobKey)) throw new PlayerNotice("看不懂這個職業，請重新執行 `/rpg job`");

    const result = await RPGService.chooseJob(interaction.user.id, jobKey);
    switch (result.status) {
      case "not_started":
        throw new PlayerNotice("你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！");
      case "level_too_low":
        throw new PlayerNotice(
          `職業在 Lv${result.requiredLevel} 開放，你現在是 Lv${result.currentLevel}。`
        );
      case "already_that_job":
        throw new PlayerNotice("你已經是這個職業了。");
      case "not_enough_gold":
        throw new PlayerNotice(
          `變更職業需要 ${result.cost} 金幣，你只有 ${result.gold} 金幣。`
        );
    }

    // 重新畫一次職業殿堂，讓「目前職業」的標記跟著更新
    const payload = await buildJobView(
      interaction.user.id,
      ownerId,
      interaction.user.username,
      interaction.user.displayAvatarURL()
    );
    await interaction.editReply(payload);

    const costNote = result.cost > 0 ? `（花費 ${result.cost} 金幣，剩 ${result.goldAfter}）` : "（首次免費）";
    await interaction.followUp({
      content: `🎖️ 你成為了 **${JOB_LABELS[result.job]}**${costNote}\n${JOB_DESCRIPTIONS[result.job]}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    const message = describeCommandError("職業選擇按鈕錯誤", error);
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  }
}

/** 給角色資料卡顯示用 */
export function jobLabelFor(job: string | null): string {
  return isJobKey(job) ? `${JOB_LABELS[job]}（${JOB_SYSTEMS[job]}）` : "無";
}
