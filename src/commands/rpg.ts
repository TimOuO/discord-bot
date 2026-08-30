import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
  ColorResolvable,
  MessageFlags,
} from "discord.js";
import { RPGService, DailyClaimResult } from "../services/rpgService";
import {
  ItemService,
  TYPE_LABELS,
  EFFECT_TYPE_LABELS,
  SLOT_LABELS,
  RARITY_LABELS,
} from "../services/itemService";

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
        { name: "等級", value: `${user.level}`, inline: true },
        {
          name: "經驗值",
          value: `${user.xp}/${user.level * 100}`,
          inline: true,
        },
        { name: "金幣", value: `${user.gold}`, inline: true },
        {
          name: "生命值",
          value: `${user.health}/${user.maxHealth}`,
          inline: true,
        },
        { name: "攻擊力", value: `${user.attack}`, inline: true },
        { name: "防禦力", value: `${user.defense}`, inline: true }
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
      .setTitle(`${username} 的角色資料`)
      .setColor("#2ecc71" as ColorResolvable)
      .addFields(
        { name: "等級", value: `${user.level}`, inline: true },
        {
          name: "經驗值",
          value: `${user.xp}/${user.level * 100}`,
          inline: true,
        },
        { name: "金幣", value: `${user.gold}`, inline: true },
        {
          name: "生命值",
          value: `${user.health}/${effectiveStats.maxHealth}`,
          inline: true,
        },
        { name: "攻擊力", value: `${effectiveStats.attack}`, inline: true },
        { name: "防禦力", value: `${effectiveStats.defense}`, inline: true }
      )
      .setFooter({
        text: `裝備加成已計入；用 /rpg inventory 查看細節・創建時間: ${user.createdAt.toLocaleDateString()}`,
      });

    if (user.lastBattle) {
      embed.addFields({
        name: "上次戰鬥",
        value: `${new Date(user.lastBattle).toLocaleString()}`,
        inline: true,
      });
    }

    if (user.lastDaily) {
      embed.addFields({
        name: "上次簽到",
        value: `${new Date(user.lastDaily).toLocaleString()}`,
        inline: true,
      });
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
      .setTitle(`${interaction.user.username} 的背包`)
      .setColor("#9b59b6" as ColorResolvable)
      .addFields({
        name: "有效屬性（基礎 + 裝備加成）",
        value: `攻擊力 ${effectiveStats.attack}（基礎 ${user.attack}）\n防禦力 ${effectiveStats.defense}（基礎 ${user.defense}）\n生命上限 ${effectiveStats.maxHealth}（基礎 ${user.maxHealth}）`,
      })
      .addFields({
        name: "裝備欄",
        value: equipped
          .map(({ slot, equipped: eq }) =>
            eq ? `${SLOT_LABELS[slot]}：${eq.item.name}` : `${SLOT_LABELS[slot]}：（空）`
          )
          .join("\n"),
      });

    if (inventory.length === 0) {
      embed.addFields({ name: "道具", value: "背包是空的，去 `/rpg shop list` 逛逛吧！" });
    } else {
      for (const type of Object.keys(TYPE_LABELS)) {
        const itemsOfType = inventory.filter((row) => row.item.type === type);
        if (itemsOfType.length === 0) continue;

        const lines = itemsOfType.map((row) => {
          const equippedTag = equippedItemIds.has(row.itemId) ? "（裝備中）" : "";
          return `${row.item.name} x${row.quantity}${equippedTag}`;
        });
        embed.addFields({ name: TYPE_LABELS[type], value: lines.join("\n") });
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

async function handleBattleCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();

    const userId = interaction.user.id;

    try {
      const battleResult = await RPGService.battle(userId);

      const color = battleResult.result === "win" ? "#2ecc71" : "#e74c3c";

      const embed = new EmbedBuilder()
        .setTitle(
          `⚔️ ${interaction.user.username} vs ${battleResult.enemyName} Lv.${battleResult.enemyLevel}`
        )
        .setDescription(battleResult.message)
        .setColor(color as ColorResolvable)
        .addFields(
          {
            name: "你的生命值",
            value: `${battleResult.user.health}/${battleResult.user.maxHealth}`,
            inline: true,
          },
          { name: "等級", value: `${battleResult.user.level}`, inline: true },
          {
            name: "經驗值",
            value: `${battleResult.user.xp}/${battleResult.user.level * 100}`,
            inline: true,
          },
          { name: "金幣", value: `${battleResult.user.gold}`, inline: true }
        );

      if (battleResult.result === "win") {
        embed.setFooter({ text: "恭喜獲勝！" });
      } else {
        embed.setFooter({ text: "不幸失敗，休息一下再來吧！" });
      }

      return interaction.editReply({ embeds: [embed] });
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

// 共用：/rpg daily 手動簽到、voiceStateUpdate.ts 的自動簽到都用這個組出一樣的 embed
export function buildDailyRewardEmbed(
  username: string,
  result: Extract<DailyClaimResult, { status: "claimed" }>
): EmbedBuilder {
  const { goldReward, streakBonus, finalGoldReward, xpReward, streak, updatedUser } = result;

  const embed = new EmbedBuilder()
    .setTitle("🎁 每日獎勵")
    .setDescription(`${username}，你已成功領取今日獎勵！`)
    .setColor("#f1c40f" as ColorResolvable)
    .addFields(
      {
        name: "獲得金幣",
        value:
          streakBonus > 0
            ? `${goldReward} + ${streakBonus} (連續獎勵) = ${finalGoldReward} 💰`
            : `${finalGoldReward} 💰`,
        inline: true,
      },
      { name: "獲得經驗", value: `${xpReward} ✨`, inline: true },
      {
        name: "生命值恢復",
        value: `${updatedUser.health}/${updatedUser.maxHealth} ❤️`,
        inline: true,
      }
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
    return interaction.editReply(
      `🎣 釣到了一隻「${result.item.name}」！（${rarityLabel}）目前擁有 ${result.quantity} 隻，還獲得了 ${result.xpGained} 經驗值。可以用 \`/rpg shop sell\` 賣掉換金幣。`
    );
  } catch (error) {
    console.error("RPG Fish 命令錯誤:", error);
    const message = error instanceof Error ? error.message : String(error);
    return interaction.editReply(`釣魚失敗：${message}`);
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
      return `**${item.name}** — ${item.cost} 金幣（${effectLabel} +${item.effectValue}）\n${item.description}`;
    });

    embed.addFields({ name: TYPE_LABELS[type], value: lines.join("\n\n") });
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
