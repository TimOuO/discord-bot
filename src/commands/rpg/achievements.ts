import {
  ChatInputCommandInteraction,
  ButtonInteraction,
  EmbedBuilder,
  ColorResolvable,
  MessageFlags,
} from "discord.js";
import { RPGService } from "../../services/rpgService";
import { AchievementService } from "../../services/achievementService";
import {
  ACHIEVEMENT_BUDGET,
  achievementBonus,
  findAchievement,
  formatBonus,
} from "../../services/achievements";
import { PlayerNotice, describeCommandError } from "../../utils/errors";
import { sectionField, chip } from "../../utils/embeds";

/**
 * 成就解鎖時要發給玩家的那則私密訊息。
 *
 * 只在「這次新記錄到」的成就上發（AchievementService.sync 的回傳值），所以不會每次
 * 打開資料卡都被通知一輪。發送刻意包在 try/catch 裡：通知失敗不該讓原本的指令跟著失敗，
 * 成就已經記進資料庫了，玩家下次打開成就列表還是看得到。
 */
export async function notifyUnlockedAchievements(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  unlockedKeys: readonly string[]
): Promise<void> {
  if (unlockedKeys.length === 0) return;

  try {
    const lines = unlockedKeys.flatMap((key) => {
      const achievement = findAchievement(key);
      if (!achievement) return [];
      return [
        `▷ **${achievement.label}**（${achievement.requirement}）→ ${formatBonus(achievement.reward)}`,
      ];
    });
    if (lines.length === 0) return;

    const total = formatBonus(achievementBonus(unlockedKeys));
    await interaction.followUp({
      content: [
        unlockedKeys.length === 1
          ? "🏅 **解鎖新成就！**"
          : `🏅 **一次解鎖了 ${unlockedKeys.length} 個成就！**`,
        ...lines,
        `這些加成已經算進你的戰鬥數值了（合計 ${total}）。`,
        "每個成就都附一個同名稱號，可以用 `/rpg title` 掛到資料卡上。",
      ].join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error("成就通知發送失敗:", error);
  }
}

/** 偵測 + 通知的組合，給只需要「順手檢查一下」的指令用（資料卡、背包、每日簽到） */
export async function syncAchievementsQuietly(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  userInternalId: string
): Promise<void> {
  try {
    const unlocked = await AchievementService.sync(userInternalId);
    await notifyUnlockedAchievements(interaction, unlocked);
  } catch (error) {
    // 偵測失敗不該讓玩家原本要做的事失敗
    console.error("成就偵測失敗:", error);
  }
}

export async function handleAchievementsCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();

    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) {
      throw new PlayerNotice("你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！");
    }

    // 先偵測再讀列表，玩家看到的才是包含這次新解鎖的完整狀態
    const unlocked = await AchievementService.sync(user.id);
    const rows = await AchievementService.listAchievements(user.id);

    const unlockedCount = rows.filter((row) => row.unlocked).length;
    const earned = achievementBonus(rows.filter((r) => r.unlocked).map((r) => r.definition.key));

    const embed = new EmbedBuilder()
      .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
      .setTitle("🏅 成就")
      .setColor("#e67e22" as ColorResolvable)
      .setDescription(
        `已解鎖 **${unlockedCount} / ${rows.length}**。成就一旦達成就永久保留——之後金幣花掉、強化退級、換了職業都不會失去。`
      );

    embed.addFields(
      sectionField("✨", "目前拿到的加成", [
        earned.attack + earned.defense + earned.maxHealth + earned.critRate + earned.dodgeRate > 0
          ? formatBonus(earned)
          : "還沒有",
        `全部解鎖可以拿到 ${formatBonus(ACHIEVEMENT_BUDGET)}`,
      ])
    );

    // 照分類分組，一組一個欄位；同一組裡照清單順序（門檻由低到高）
    const groups = [...new Set(rows.map((row) => row.definition.group))];
    for (const group of groups) {
      const groupRows = rows.filter((row) => row.definition.group === group);
      embed.addFields(
        sectionField(
          groupRows.every((row) => row.unlocked) ? "✅" : "▫️",
          `${group}（${groupRows.filter((r) => r.unlocked).length}/${groupRows.length}）`,
          groupRows.map((row) =>
            row.unlocked
              ? `~~${row.definition.label}~~ ${chip(formatBonus(row.definition.reward))} ✅`
              : `${row.definition.label}：${row.definition.requirement} ${chip(formatBonus(row.definition.reward))}`
          )
        )
      );
    }

    embed.setFooter({ text: "成就附贈的稱號可以用 /rpg title 掛到資料卡上" });

    await interaction.editReply({ embeds: [embed] });
    // 通知放在卡片後面，玩家先看到完整列表再收到「剛剛解鎖了什麼」
    return notifyUnlockedAchievements(interaction, unlocked);
  } catch (error) {
    const message = describeCommandError("RPG Achievements 命令錯誤", error);
    return interaction.editReply(`查看成就失敗：${message}`);
  }
}
