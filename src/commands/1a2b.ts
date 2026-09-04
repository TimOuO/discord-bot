import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { randomInt } from "../utils/random";
import type { Command } from "./index";

interface GuessRecord {
  guess: number;
  a: number;
  b: number;
}

interface OneA2BGame {
  secret: number;
  guesses: GuessRecord[];
}

// 1A2B 進行中場次，依「使用者」分開，每人自己玩自己的
const activeGames = new Map<string, OneA2BGame>();

function digitsOf(n: number): number[] {
  return String(n).split("").map(Number);
}

// 產生 4 位不重複、不開頭 0 的密碼：洗牌 0~9，取前 4 個，第一位是 0 的話跟第二位互換
function generateSecret(): number {
  const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  if (pool[0] === 0) {
    [pool[0], pool[1]] = [pool[1], pool[0]];
  }
  return Number(pool.slice(0, 4).join(""));
}

function isValidGuess(value: number): boolean {
  if (value < 1000 || value > 9999) return false;
  return new Set(digitsOf(value)).size === 4;
}

function scoreGuess(secret: number, guess: number): { a: number; b: number } {
  const secretDigits = digitsOf(secret);
  const guessDigits = digitsOf(guess);

  let a = 0;
  for (let i = 0; i < 4; i++) {
    if (secretDigits[i] === guessDigits[i]) a++;
  }

  const secretSet = new Set(secretDigits);
  const common = guessDigits.filter((d) => secretSet.has(d)).length;

  return { a, b: common - a };
}

function formatHistory(guesses: GuessRecord[]): string {
  return guesses
    .map((g, i) => `第 ${i + 1} 次：${g.guess} → ${g.a}A${g.b}B`)
    .join("\n");
}

export default {
  data: new SlashCommandBuilder()
    .setName("1a2b")
    .setDescription("1A2B 猜數字遊戲")
    .addSubcommand((subcommand) =>
      subcommand.setName("start").setDescription("開始一場新的 1A2B")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("guess")
        .setDescription("猜一個 4 位數字（不能重複、不能開頭 0）")
        .addIntegerOption((option) =>
          option.setName("number").setDescription("你猜的 4 位數字").setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "start") {
      const hadPreviousGame = activeGames.has(interaction.user.id);
      activeGames.set(interaction.user.id, { secret: generateSecret(), guesses: [] });

      const restartNote = hadPreviousGame ? "（原本進行中的那場已經重新開始）" : "";
      return interaction.reply({
        content: `🔢 我想好一組 4 位不重複、不開頭 0 的數字了，用 \`/1a2b guess\` 猜猜看吧！${restartNote}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (subcommand === "guess") {
      const game = activeGames.get(interaction.user.id);
      if (!game) {
        return interaction.reply({
          content: "你還沒開始遊戲喔，先用 `/1a2b start` 開始一場！",
          flags: MessageFlags.Ephemeral,
        });
      }

      const guess = interaction.options.getInteger("number", true);
      if (!isValidGuess(guess)) {
        return interaction.reply({
          content: `「${guess}」不是有效的猜測，要是 4 位不重複、不開頭 0 的數字（例如 1234）`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const { a, b } = scoreGuess(game.secret, guess);
      game.guesses.push({ guess, a, b });

      if (a === 4) {
        activeGames.delete(interaction.user.id);
        return interaction.reply({
          content: `🎉 猜中了！答案就是 ${game.secret}，你總共猜了 ${game.guesses.length} 次！\n\n${formatHistory(
            game.guesses
          )}`,
          flags: MessageFlags.Ephemeral,
        });
      }

      return interaction.reply({
        content: `目前紀錄：\n${formatHistory(game.guesses)}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
