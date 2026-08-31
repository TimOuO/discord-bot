import { ExtendedClient } from "../structures/ExtendedClient";
import {
  ButtonInteraction,
  StringSelectMenuInteraction,
  Interaction,
  InteractionReplyOptions,
  MessageFlags,
} from "discord.js";
import {
  handleBattleRematchButton,
  handleFishSellButton,
  handleFishSellAllButton,
  handleShopSellAllButton,
  handleInventoryPageButton,
  handleInventorySelect,
  handleInventoryEquipButton,
  handleInventoryUseButton,
  handleInventorySellButton,
} from "../commands/rpg";

// customId 前綴對應到的按鈕處理函式；新增按鈕時在這裡註冊就好
const BUTTON_HANDLERS: Record<string, (interaction: ButtonInteraction) => Promise<void>> = {
  battle_rematch: handleBattleRematchButton,
  fish_sell: handleFishSellButton,
  fish_sell_all: handleFishSellAllButton,
  shop_sell_all: handleShopSellAllButton,
  inv_page: handleInventoryPageButton,
  inv_equip: handleInventoryEquipButton,
  inv_use: handleInventoryUseButton,
  inv_sell: handleInventorySellButton,
};

// customId 前綴對應到的下拉選單處理函式
const SELECT_HANDLERS: Record<string, (interaction: StringSelectMenuInteraction) => Promise<void>> = {
  inv_select: handleInventorySelect,
};

export default (client: ExtendedClient): void => {
  client.on("interactionCreate", async (interaction: Interaction) => {
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (!command?.autocomplete) return;

      try {
        await command.autocomplete(interaction);
      } catch (error) {
        console.error(`處理 ${interaction.commandName} 自動完成時發生錯誤:`, error);
      }
      return;
    }

    if (interaction.isButton()) {
      const prefix = interaction.customId.split(":")[0];
      const handler = BUTTON_HANDLERS[prefix];
      if (!handler) return;

      try {
        await handler(interaction);
      } catch (error) {
        console.error(`處理按鈕 ${interaction.customId} 時發生錯誤:`, error);
      }
      return;
    }

    if (interaction.isStringSelectMenu()) {
      const prefix = interaction.customId.split(":")[0];
      const handler = SELECT_HANDLERS[prefix];
      if (!handler) return;

      try {
        await handler(interaction);
      } catch (error) {
        console.error(`處理選單 ${interaction.customId} 時發生錯誤:`, error);
      }
      return;
    }

    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);

      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`執行 ${interaction.commandName} 命令時發生錯誤:`, error);

        try {
          const errorResponse: InteractionReplyOptions = {
            content: "執行此命令時發生錯誤！",
            flags: MessageFlags.Ephemeral,
          };

          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorResponse);
          } else {
            await interaction.reply(errorResponse);
          }
        } catch (followUpError) {
          console.error("回應錯誤消息失敗:", followUpError);
        }
      }
    }
  });
};
