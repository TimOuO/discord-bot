import {
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  EmbedBuilder,
  ColorResolvable,
  MessageFlags,
} from "discord.js";
import { RPGService } from "../../services/rpgService";
import { AchievementService } from "../../services/achievementService";
import { TITLE_SHOP, findAchievement, titleText } from "../../services/achievements";
import { PlayerNotice, describeCommandError } from "../../utils/errors";
import { buildCustomId, parseCustomId, requireInteractionOwner } from "../../utils/interactions";
import { sectionField, chip } from "../../utils/embeds";

/** Discord 的下拉選單一次最多 25 個選項 */
const MAX_SELECT_OPTIONS = 25;
const NO_TITLE_VALUE = "__none__";

async function buildTitleView(
  discordUserId: string,
  ownerId: string,
  username: string,
  avatarURL: string
) {
  const user = await RPGService.findUserByDiscordId(discordUserId);
  if (!user) {
    throw new PlayerNotice("你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！");
  }

  const rows = await AchievementService.listTitles(user.id);
  const owned = rows.filter((row) => row.owned);
  const forSale = rows.filter((row) => row.definition.source === "shop" && !row.owned);

  const embed = new EmbedBuilder()
    .setAuthor({ name: username, iconURL: avatarURL })
    .setTitle("🎗️ 稱號")
    .setColor("#9b59b6" as ColorResolvable)
    .setDescription(
      "稱號只會顯示在你的角色資料卡上，**不影響任何數值**。能力值是成就給的，稱號只是它順便附上的裝飾。"
    );

  embed.addFields(
    sectionField("📌", "目前掛著", [titleText(user.title) ?? "沒有掛稱號"], true),
    sectionField("💰", "你的金幣", [chip(user.gold.toLocaleString("en-US"))], true)
  );

  embed.addFields(
    sectionField(
      "🏅",
      `擁有的稱號（${owned.length}）`,
      owned.length > 0
        ? owned.map(
            (row) =>
              `${row.equipped ? "**" : ""}${row.definition.text}${row.equipped ? "**（掛著）" : ""}` +
              `${row.definition.source === "shop" ? "（買的）" : ""}`
          )
        : [
            "還沒有。達成任何一個成就就會附贈一個同名稱號（`/rpg achievements`），或是在下面的稱號店買。",
          ]
    )
  );

  if (forSale.length > 0) {
    embed.addFields(
      sectionField(
        "🛒",
        "稱號店",
        forSale.map((row) => {
          const cost = row.definition.cost ?? 0;
          const affordable = user.gold >= cost;
          return `${affordable ? "▫️" : "🔒"} ${row.definition.text} ${chip(`${cost.toLocaleString("en-US")} 金幣`)}`;
        })
      )
    );
  }

  const components: ActionRowBuilder<StringSelectMenuBuilder>[] = [];

  // 掛稱號的選單：擁有的稱號 +「拿掉稱號」。超過 25 個就只列前面的（成就 18 + 店裡 6 還在上限內）
  const equipOptions = [
    { label: "不掛稱號", value: NO_TITLE_VALUE, description: "把資料卡上的稱號拿掉" },
    ...owned.slice(0, MAX_SELECT_OPTIONS - 1).map((row) => ({
      label: row.definition.text,
      value: row.definition.key,
      description:
        row.definition.source === "shop"
          ? "在稱號店買的"
          : `來自成就：${findAchievement(row.definition.key)?.label ?? row.definition.text}`,
      default: row.equipped,
    })),
  ];
  components.push(
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(buildCustomId("title_equip", ownerId))
        .setPlaceholder("選一個稱號掛到資料卡上")
        .addOptions(equipOptions)
    )
  );

  if (forSale.length > 0) {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(buildCustomId("title_buy", ownerId))
          .setPlaceholder("在稱號店買一個稱號")
          .addOptions(
            forSale.slice(0, MAX_SELECT_OPTIONS).map((row) => ({
              label: row.definition.text,
              value: row.definition.key,
              description: `${(row.definition.cost ?? 0).toLocaleString("en-US")} 金幣`,
            }))
          )
      )
    );
  }

  return { embeds: [embed], components };
}

export async function handleTitleCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();
    const payload = await buildTitleView(
      interaction.user.id,
      interaction.user.id,
      interaction.user.username,
      interaction.user.displayAvatarURL()
    );
    return interaction.editReply(payload);
  } catch (error) {
    const message = describeCommandError("RPG Title 命令錯誤", error);
    return interaction.editReply(`查看稱號失敗：${message}`);
  }
}

export async function handleTitleEquipSelect(interaction: StringSelectMenuInteraction) {
  const { ownerId } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;

  await interaction.deferUpdate();
  try {
    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) throw new PlayerNotice("你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！");

    const picked = interaction.values[0];
    const titleKey = picked === NO_TITLE_VALUE ? null : picked;
    await AchievementService.equipTitle(user.id, titleKey);

    const payload = await buildTitleView(
      interaction.user.id,
      ownerId,
      interaction.user.username,
      interaction.user.displayAvatarURL()
    );
    await interaction.editReply(payload);

    await interaction.followUp({
      content: titleKey
        ? `🎗️ 稱號換成「${titleText(titleKey)}」了，用 \`/rpg profile\` 看看。`
        : "🎗️ 已經把稱號拿掉了。",
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    const message = describeCommandError("稱號掛載選單錯誤", error);
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  }
}

export async function handleTitleBuySelect(interaction: StringSelectMenuInteraction) {
  const { ownerId } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;

  await interaction.deferUpdate();
  try {
    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) throw new PlayerNotice("你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！");

    const titleKey = interaction.values[0];
    const title = TITLE_SHOP.find((t) => t.key === titleKey);
    const { goldAfter } = await AchievementService.buyTitle(user.id, titleKey);

    const payload = await buildTitleView(
      interaction.user.id,
      ownerId,
      interaction.user.username,
      interaction.user.displayAvatarURL()
    );
    await interaction.editReply(payload);

    await interaction.followUp({
      content: `🎗️ 買下了「${title?.text ?? titleKey}」，剩 ${goldAfter.toLocaleString("en-US")} 金幣。用上面的選單就能掛上去。`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    const message = describeCommandError("稱號購買選單錯誤", error);
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  }
}
