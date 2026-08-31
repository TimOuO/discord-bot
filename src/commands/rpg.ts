import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  ButtonInteraction,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ColorResolvable,
  MessageFlags,
} from "discord.js";
import { RPGService, DailyClaimResult, xpThresholdForLevel } from "../services/rpgService";
import {
  ItemService,
  TYPE_LABELS,
  EFFECT_TYPE_LABELS,
  SLOT_LABELS,
  RARITY_LABELS,
} from "../services/itemService";
import { buildCustomId, parseCustomId, requireInteractionOwner } from "../utils/interactions";
import { sectionField, chip } from "../utils/embeds";

const EQUIPPABLE_TYPES = ["weapon", "armor", "accessory"];

export default {
  data: new SlashCommandBuilder()
    .setName("rpg")
    .setDescription("RPG 遊戲相關指令")
    .addSubcommand((subcommand) =>
      subcommand.setName("start").setDescription("開始你的 RPG 冒險")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("profile").setDescription("查看你的角色資料")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("inventory").setDescription("查看你的背包與裝備")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("battle").setDescription("在 RPG 遊戲中戰鬥")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("daily").setDescription("領取每日獎勵")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("fish").setDescription("到河邊釣魚，有機會釣到稀有魚類")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("equip")
        .setDescription("裝備武器、防具或飾品")
        .addStringOption((option) =>
          option
            .setName("item")
            .setDescription("要裝備的道具")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("use")
        .setDescription("使用藥水")
        .addStringOption((option) =>
          option
            .setName("item")
            .setDescription("要使用的藥水")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName("shop")
        .setDescription("商店：查看、購買、販賣道具")
        .addSubcommand((subcommand) =>
          subcommand.setName("list").setDescription("查看商店所有道具")
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("buy")
            .setDescription("購買道具")
            .addStringOption((option) =>
              option
                .setName("item")
                .setDescription("要購買的道具")
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("sell")
            .setDescription("販賣道具（原價 50%）")
            .addStringOption((option) =>
              option
                .setName("item")
                .setDescription("要販賣的道具")
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();

    if (group === "shop") {
      switch (subcommand) {
        case "list":
          return handleShopList(interaction);
        case "buy":
          return handleShopBuy(interaction);
        case "sell":
          return handleShopSell(interaction);
      }
      return;
    }

    switch (subcommand) {
      case "start":
        return handleStartCommand(interaction);
      case "profile":
        return handleProfileCommand(interaction);
      case "inventory":
        return handleInventoryCommand(interaction);
      case "battle":
        return handleBattleCommand(interaction);
      case "daily":
        return handleDailyCommand(interaction);
      case "fish":
        return handleFishCommand(interaction);
      case "equip":
        return handleEquipCommand(interaction);
      case "use":
        return handleUseCommand(interaction);
      default:
        return interaction.reply({
          content: "未知的子指令",
          flags: MessageFlags.Ephemeral,
        });
    }
  },

  async autocomplete(interaction: AutocompleteInteraction) {
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();

    if (group === "shop") {
      if (subcommand === "buy") return shopBuyAutocomplete(interaction);
      if (subcommand === "sell") return shopSellAutocomplete(interaction);
      return interaction.respond([]);
    }

    if (subcommand === "equip") return equipAutocomplete(interaction);
    if (subcommand === "use") return useAutocomplete(interaction);
    return interaction.respond([]);
  },
};

async function handleStartCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();

    const userId = interaction.user.id;
    const username = interaction.user.username;

    const existingUser = await RPGService.findUserByDiscordId(userId);
    if (existingUser) {
      return interaction.editReply(
        `你已經開始過冒險了，${username}！目前是 Lv.${existingUser.level}。用 \`/rpg profile\` 查看完整角色資料。`
      );
    }

    const user = await RPGService.startRPG(userId, username);

    const embed = new EmbedBuilder()
      .setTitle("🎮 RPG 冒險開始！")
      .setDescription(`歡迎來到這個充滿奇幻的世界，${username}！`)
      .setColor("#3498db" as ColorResolvable)
      .addFields(
        sectionField("📊", "初始屬性", [
          `等級 ${chip(user.level)}`,
          `經驗值 ${chip(user.xp)} / ${chip(xpThresholdForLevel(user.level))}`,
          `金幣 ${chip(user.gold)}`,
          `生命值 ${chip(user.health)} / ${chip(user.maxHealth)}`,
          `攻擊力 ${chip(user.attack)}`,
          `防禦力 ${chip(user.defense)}`,
        ])
      )
      .setFooter({ text: "使用 /rpg battle 開始戰鬥，/rpg daily 領取每日獎勵" });

    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("RPG Start 命令錯誤:", error);
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`RPG 遊戲開始失敗: ${message}`);
  }
}

async function handleProfileCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();

    const userId = interaction.user.id;
    const username = interaction.user.username;

    // 獲取或創建用戶
    const user = await RPGService.getOrCreateUser(userId, username);
    const effectiveStats = await ItemService.getEffectiveStats(user.id, {
      attack: user.attack,
      defense: user.defense,
      maxHealth: user.maxHealth,
    });

    const embed = new EmbedBuilder()
      .setAuthor({ name: username, iconURL: interaction.user.displayAvatarURL() })
      .setTitle(`${username} 的角色資料`)
      .setColor("#2ecc71" as ColorResolvable)
      .addFields(
        sectionField("📊", "角色狀態", [
          `等級 ${chip(user.level)}`,
          `經驗值 ${chip(user.xp)} / ${chip(xpThresholdForLevel(user.level))}`,
          `金幣 ${chip(user.gold)}`,
          `生命值 ${chip(user.health)} / ${chip(effectiveStats.maxHealth)}`,
          `攻擊力 ${chip(effectiveStats.attack)}`,
          `防禦力 ${chip(effectiveStats.defense)}`,
        ])
      )
      .setFooter({
        text: `裝備加成已計入；用 /rpg inventory 查看細節・創建時間: ${user.createdAt.toLocaleDateString()}`,
      });

    const historyLines: string[] = [];
    if (user.lastBattle) {
      historyLines.push(`上次戰鬥 ${chip(new Date(user.lastBattle).toLocaleString())}`);
    }
    if (user.lastDaily) {
      historyLines.push(`上次簽到 ${chip(new Date(user.lastDaily).toLocaleString())}`);
    }
    if (historyLines.length > 0) {
      embed.addFields(sectionField("🕒", "時間紀錄", historyLines));
    }

    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("RPG Profile 命令錯誤:", error);
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`獲取角色資料失敗: ${message}`);
  }
}

async function handleInventoryCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) {
      return interaction.editReply(
        "你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！"
      );
    }

    const [inventory, equipped, effectiveStats] = await Promise.all([
      ItemService.getInventory(user.id),
      ItemService.getEquipped(user.id),
      ItemService.getEffectiveStats(user.id, {
        attack: user.attack,
        defense: user.defense,
        maxHealth: user.maxHealth,
      }),
    ]);

    const equippedItemIds = new Set(
      equipped.filter((e) => e.equipped).map((e) => e.equipped!.itemId)
    );

    const embed = new EmbedBuilder()
      .setAuthor({
        name: interaction.user.username,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .setTitle(`${interaction.user.username} 的背包`)
      .setColor("#9b59b6" as ColorResolvable)
      .addFields(
        sectionField("📊", "有效屬性（基礎 + 裝備加成）", [
          `攻擊力 ${chip(effectiveStats.attack)}（基礎 ${chip(user.attack)}）`,
          `防禦力 ${chip(effectiveStats.defense)}（基礎 ${chip(user.defense)}）`,
          `生命上限 ${chip(effectiveStats.maxHealth)}（基礎 ${chip(user.maxHealth)}）`,
        ]),
        sectionField(
          "🎒",
          "裝備欄",
          equipped.map(({ slot, equipped: eq }) =>
            eq ? `${SLOT_LABELS[slot]}：${eq.item.name}` : `${SLOT_LABELS[slot]}：（空）`
          )
        )
      );

    if (inventory.length === 0) {
      embed.addFields(
        sectionField("🧳", "道具", ["背包是空的，去 `/rpg shop list` 逛逛吧！"])
      );
    } else {
      for (const type of Object.keys(TYPE_LABELS)) {
        const itemsOfType = inventory.filter((row) => row.item.type === type);
        if (itemsOfType.length === 0) continue;

        const lines = itemsOfType.map((row) => {
          const equippedTag = equippedItemIds.has(row.itemId) ? "（裝備中）" : "";
          return `${row.item.name} x${chip(row.quantity)}${equippedTag}`;
        });
        embed.addFields(sectionField("🧳", TYPE_LABELS[type], lines));
      }
    }

    embed.setFooter({ text: "使用 /rpg equip 裝備道具、/rpg use 使用藥水" });

    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("RPG Inventory 命令錯誤:", error);
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`查看背包失敗：${message}`);
  }
}

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
    .setColor(color as ColorResolvable)
    .addFields(
      sectionField("⚔️", "戰鬥結果", [battleResult.message]),
      sectionField("📊", "目前狀態", [
        `生命值 ${chip(battleResult.user.health)} / ${chip(battleResult.user.maxHealth)}`,
        `等級 ${chip(battleResult.user.level)}`,
        `經驗值 ${chip(battleResult.user.xp)} / ${chip(xpThresholdForLevel(battleResult.user.level))}`,
        `金幣 ${chip(battleResult.user.gold)}`,
      ])
    );

  embed.setFooter({ text: battleResult.result === "win" ? "恭喜獲勝！" : "不幸失敗，休息一下再來吧！" });

  return { embeds: [embed], components: [buildBattleRematchRow(userId)] };
}

async function handleBattleCommand(interaction: ChatInputCommandInteraction) {
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

// 共用：/rpg daily 手動簽到、voiceStateUpdate.ts 的自動簽到都用這個組出一樣的 embed
export function buildDailyRewardEmbed(
  username: string,
  result: Extract<DailyClaimResult, { status: "claimed" }>
): EmbedBuilder {
  const { goldReward, streakBonus, finalGoldReward, xpReward, streak, updatedUser } = result;

  const embed = new EmbedBuilder()
    .setTitle("🎁 每日獎勵")
    .setColor("#f1c40f" as ColorResolvable)
    .addFields(
      sectionField("🎁", "簽到獎勵", [
        `${username}，你已成功領取今日獎勵！`,
        streakBonus > 0
          ? `獲得金幣 ${chip(goldReward)} + ${chip(streakBonus)}（連續獎勵）= ${chip(finalGoldReward)} 💰`
          : `獲得金幣 ${chip(finalGoldReward)} 💰`,
        `獲得經驗 ${chip(xpReward)} ✨`,
        `生命值恢復 ${chip(updatedUser.health)} / ${chip(updatedUser.maxHealth)} ❤️`,
      ])
    );

  if (streak >= 30) {
    embed.setFooter({ text: `🔥 連續登入: ${streak} 天 - 傳奇級玩家！` });
  } else if (streak >= 15) {
    embed.setFooter({ text: `🔥 連續登入: ${streak} 天 - 專業玩家！` });
  } else if (streak >= 7) {
    embed.setFooter({ text: `🔥 連續登入: ${streak} 天 - 忠實玩家！` });
  } else if (streak >= 3) {
    embed.setFooter({ text: `🔥 連續登入: ${streak} 天 - 認真玩家！` });
  } else {
    embed.setFooter({ text: `連續登入: ${streak} 天` });
  }

  embed.setTimestamp();
  return embed;
}

async function handleDailyCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();

    const result = await RPGService.claimDaily(interaction.user.id);

    if (result.status === "not_started") {
      return interaction.editReply(
        "你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！"
      );
    }

    if (result.status === "already_claimed") {
      return interaction.editReply(
        `⏰ 你今天已經領取過獎勵了！下次領取時間：**${result.remainingHours}小時${result.remainingMinutes}分鐘**後（明天00:00）。`
      );
    }

    const embed = buildDailyRewardEmbed(interaction.user.username, result);
    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Daily command error:", error);
    return interaction.editReply("領取每日獎勵時發生錯誤，請稍後再試。");
  }
}

function buildFishSellRow(ownerId: string, itemName: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId("fish_sell", ownerId, itemName))
      .setLabel("立即賣掉")
      .setEmoji("💰")
      .setStyle(ButtonStyle.Secondary)
  );
}

async function handleFishCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();

    const result = await RPGService.fish(interaction.user.id);

    if (result.status === "not_started") {
      return interaction.editReply(
        "你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！"
      );
    }
    if (result.status === "cooldown") {
      return interaction.editReply(
        `🎣 魚餌還沒準備好，請等待 ${result.remainingSeconds} 秒後再釣。`
      );
    }
    if (result.status === "empty") {
      return interaction.editReply(`🎣 ${result.message}`);
    }

    const rarityLabel = RARITY_LABELS[result.item.rarity] ?? result.item.rarity;
    const embed = new EmbedBuilder()
      .setAuthor({
        name: interaction.user.username,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .setTitle("🎣 釣魚成功！")
      .setColor("#3498db" as ColorResolvable)
      .addFields(
        sectionField("🎣", "釣魚結果", [
          `釣到了一隻 \`${result.item.name}\`（${rarityLabel}）`,
          `目前擁有 ${chip(result.quantity)} 隻`,
          `獲得經驗 ${chip(result.xpGained)} ✨`,
        ])
      );

    return interaction.editReply({
      embeds: [embed],
      components: [buildFishSellRow(interaction.user.id, result.item.name)],
    });
  } catch (error) {
    console.error("RPG Fish 命令錯誤:", error);
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`釣魚失敗：${message}`);
  }
}

// interactionCreate.ts 會把 "fish_sell:*" 的按鈕點擊導到這裡；只賣掉剛釣到的這一隻，不是全部
export async function handleFishSellButton(interaction: ButtonInteraction) {
  const { ownerId, args } = parseCustomId(interaction.customId);
  if (!(await requireInteractionOwner(interaction, ownerId))) return;

  const itemName = args[0];

  await interaction.deferUpdate();
  try {
    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) throw new Error("找不到你的角色資料");

    const { sellPrice } = await ItemService.sellItem(user.id, itemName);

    const originalEmbed = interaction.message.embeds[0];
    const embed = originalEmbed
      ? EmbedBuilder.from(originalEmbed)
          .setColor("#95a5a6" as ColorResolvable)
          .addFields({ name: "已賣出", value: `💰 +${sellPrice} 金幣` })
      : new EmbedBuilder().setDescription(`已賣出，獲得 ${sellPrice} 金幣`);

    await interaction.editReply({ embeds: [embed], components: [] });
  } catch (error) {
    // 賣不掉（例如剛好被裝備上、或已經賣完了）不動原本卡片，只用 ephemeral 提示
    const message = error instanceof Error ? error.message : String(error);
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
  }
}

async function handleEquipCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) {
      return interaction.editReply(
        "你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！"
      );
    }

    const itemName = interaction.options.getString("item", true);
    const { item, slot, replacedItem } = await ItemService.equipItem(
      user.id,
      itemName
    );

    const slotLabel = SLOT_LABELS[slot];
    if (replacedItem) {
      return interaction.editReply(
        `✅ ${slotLabel}欄已換成「${item.name}」（原本的「${replacedItem.name}」已卸下，還在背包裡）。`
      );
    }
    return interaction.editReply(`✅ 已將「${item.name}」裝備到${slotLabel}欄。`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`裝備失敗：${message}`);
  }
}

async function equipAutocomplete(interaction: AutocompleteInteraction) {
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

async function handleUseCommand(interaction: ChatInputCommandInteraction) {
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

async function useAutocomplete(interaction: AutocompleteInteraction) {
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

async function handleShopList(interaction: ChatInputCommandInteraction) {
  const items = await ItemService.getShopCatalog();

  const embed = new EmbedBuilder()
    .setTitle("🛒 商店")
    .setColor("#f39c12" as ColorResolvable)
    .setFooter({ text: "使用 /rpg shop buy 購買道具、/rpg shop sell 販賣道具" });

  for (const type of Object.keys(TYPE_LABELS)) {
    const itemsOfType = items.filter((item) => item.type === type);
    if (itemsOfType.length === 0) continue;

    const lines = itemsOfType.map((item) => {
      const effectLabel = EFFECT_TYPE_LABELS[item.effectType] ?? item.effectType;
      return `**${item.name}** — ${chip(item.cost)} 金幣（${effectLabel} +${chip(item.effectValue)}）${item.description}`;
    });

    embed.addFields(sectionField("🛒", TYPE_LABELS[type], lines));
  }

  return interaction.reply({ embeds: [embed] });
}

async function handleShopBuy(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) {
      return interaction.editReply(
        "你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！"
      );
    }

    const itemName = interaction.options.getString("item", true);
    const { item, quantity, autoEquippedSlot } = await ItemService.buyItem(
      user.id,
      itemName
    );

    const equipNote = autoEquippedSlot
      ? `，並自動裝備到${SLOT_LABELS[autoEquippedSlot]}欄！`
      : "";

    return interaction.editReply(
      `✅ 花費 ${item.cost} 金幣購買了「${item.name}」！目前擁有 ${quantity} 個${equipNote}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`購買失敗：${message}`);
  }
}

async function handleShopSell(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = await RPGService.findUserByDiscordId(interaction.user.id);
    if (!user) {
      return interaction.editReply(
        "你尚未開始 RPG 冒險。請先使用 `/rpg start` 命令開始遊戲！"
      );
    }

    const itemName = interaction.options.getString("item", true);
    const { item, sellPrice } = await ItemService.sellItem(user.id, itemName);

    return interaction.editReply(`💰 賣掉「${item.name}」，獲得 ${sellPrice} 金幣。`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`販賣失敗：${message}`);
  }
}

async function shopBuyAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused().trim();
  const items = await ItemService.getShopCatalog();
  const filtered = items.filter((item) => item.name.includes(focused)).slice(0, 25);
  return interaction.respond(
    filtered.map((item) => ({
      name: `${item.name}（${item.cost} 金幣）`,
      value: item.name,
    }))
  );
}

async function shopSellAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused().trim();
  const user = await RPGService.findUserByDiscordId(interaction.user.id);
  if (!user) return interaction.respond([]);

  const inventory = await ItemService.getInventory(user.id);
  const filtered = inventory
    .filter((row) => row.item.name.includes(focused))
    .slice(0, 25);
  return interaction.respond(
    filtered.map((row) => ({
      name: `${row.item.name} x${row.quantity}（賣 ${Math.floor(row.item.cost * 0.5)} 金幣）`,
      value: row.item.name,
    }))
  );
}
