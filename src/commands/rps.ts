import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { randomInt } from "../utils/random";
import type { Command } from "./index";

const HANDS = ["✌️", "✊", "🖐️"];

export default {
  data: new SlashCommandBuilder().setName("rps").setDescription("隨機出一個猜拳手勢"),

  async execute(interaction: ChatInputCommandInteraction) {
    const hand = HANDS[randomInt(0, HANDS.length)];
    await interaction.reply(hand);
  },
};
