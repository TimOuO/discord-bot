import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  MessageFlags,
} from "discord.js";
import { handleStartCommand, handleProfileCommand, handleInventoryCommand } from "./character";
import { handleBattleCommand, handleBattleRematchButton } from "./battle";
import { handleDailyCommand, buildDailyRewardEmbed } from "./daily";
import { handleFishCommand, handleFishSellButton } from "./fish";
import { handleEquipCommand, equipAutocomplete, handleUseCommand, useAutocomplete } from "./items";
import {
  handleShopList,
  handleShopBuy,
  handleShopSell,
  handleShopSellAllButton,
  shopBuyAutocomplete,
  shopSellAutocomplete,
} from "./shop";

// 按鈕/選單 handler、buildDailyRewardEmbed 給 interactionCreate.ts、voiceStateUpdate.ts 用
export {
  handleBattleRematchButton,
  handleFishSellButton,
  handleShopSellAllButton,
  buildDailyRewardEmbed,
};

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
            .setDescription("販賣道具（商店買的原價 50%，釣到的魚全額賣出）")
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
