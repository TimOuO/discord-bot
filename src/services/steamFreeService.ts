import { Client, EmbedBuilder } from "discord.js";
import { config } from "../config";
import prisma from "./dbService";
import { fetchCandidateAppIds, verifyOnSteam, FreeGame } from "./steamFreeGames";

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

// 公告紀錄保留多久才能被清掉。只清「已經不在候選清單、而且公告超過這麼久」的紀錄：
// 如果 CheapShark 某次回傳暫時漏掉某個遊戲，不會因此清掉紀錄、等它回來又重複公告一次；
// 同一款遊戲過幾個月再次限時免費時，紀錄早就清掉了，會正常再公告
const ANNOUNCED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// Discord 一則訊息最多 10 個 embed
const MAX_EMBEDS_PER_MESSAGE = 10;

const STEAM_BLUE = 0x1b2838;

export function buildFreeGameEmbed(game: FreeGame): EmbedBuilder {
  const price = game.originalPrice ? `原價 ~~${game.originalPrice}~~ → **免費**` : "**免費**";
  // Discord 的時間戳格式：每個人看到的是自己時區的時間，括號裡的倒數會自動更新
  const endsAtSeconds = game.endsAt ? Math.floor(game.endsAt.getTime() / 1000) : null;
  const deadline = endsAtSeconds ? `<t:${endsAtSeconds}:F>（<t:${endsAtSeconds}:R>）` : "未公布";

  return new EmbedBuilder()
    .setColor(STEAM_BLUE)
    .setTitle(game.title)
    .setURL(game.storeUrl)
    .setDescription(`${price}，領取後永久保留\n⏰ 領取截止：${deadline}`)
    .setImage(game.headerImageUrl);
}

/** 要公告到哪些頻道：有設定 STEAM_FREE_CHANNEL_IDS 就用它，沒有的話跟著每個伺服器的簽到公告頻道 */
export function resolveAnnounceChannelIds(): string[] {
  if (config.steamFreeChannelIds.length > 0) return config.steamFreeChannelIds;
  return [...new Set(config.dailyAnnounceChannelsByGuild.values())];
}

/** 還沒公告過的 App ID */
export async function findUnannounced(steamAppIds: string[]): Promise<string[]> {
  if (steamAppIds.length === 0) return [];
  const announced = await prisma.announcedFreeGame.findMany({
    where: { steamAppId: { in: steamAppIds } },
    select: { steamAppId: true },
  });
  const announcedIds = new Set(announced.map((a) => a.steamAppId));
  return steamAppIds.filter((id) => !announcedIds.has(id));
}

export async function markAnnounced(games: FreeGame[]): Promise<void> {
  for (const game of games) {
    await prisma.announcedFreeGame.upsert({
      where: { steamAppId: game.steamAppId },
      create: { steamAppId: game.steamAppId, title: game.title },
      update: {},
    });
  }
}

/** 清掉已經不在候選清單、而且公告夠久的紀錄 */
export async function pruneAnnounced(candidateAppIds: string[], now: Date): Promise<void> {
  await prisma.announcedFreeGame.deleteMany({
    where: {
      steamAppId: { notIn: candidateAppIds },
      announcedAt: { lt: new Date(now.getTime() - ANNOUNCED_RETENTION_MS) },
    },
  });
}

/** 把遊戲發到一個頻道，回傳有沒有成功 */
async function announceToChannel(
  client: Client,
  channelId: string,
  games: FreeGame[]
): Promise<boolean> {
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isSendable()) {
      console.error(`限時免費公告頻道 ${channelId} 不存在或機器人沒有發言權限`);
      return false;
    }

    for (let i = 0; i < games.length; i += MAX_EMBEDS_PER_MESSAGE) {
      const batch = games.slice(i, i + MAX_EMBEDS_PER_MESSAGE);
      await channel.send({
        content: i === 0 ? "🎮 Steam 限時免費！趁還沒結束快去領：" : undefined,
        embeds: batch.map(buildFreeGameEmbed),
      });
    }
    return true;
  } catch (error) {
    console.error(`限時免費公告發到頻道 ${channelId} 失敗:`, error);
    return false;
  }
}

let checking = false;

async function checkAndAnnounce(client: Client, channelIds: string[]): Promise<void> {
  // 上一輪還沒跑完（例如 API 很慢）就不要疊一輪，免得同一款遊戲被公告兩次
  if (checking) return;
  checking = true;

  try {
    const candidates = await fetchCandidateAppIds();
    // 確認不是限時免費的候選不做紀錄，下一輪會再確認一次——例如美國區限時免費、
    // 台灣區還沒開始，等台灣區也開始時就會正常公告。Steam 查不到的話整輪丟錯，下一輪再試
    const games = await verifyOnSteam(await findUnannounced(candidates));

    if (games.length > 0) {
      const results = await Promise.all(
        channelIds.map((id) => announceToChannel(client, id, games))
      );
      // 至少一個頻道發成功才記下來。全部失敗（例如 Discord 暫時掛掉）的話下一輪會再試；
      // 只有某個頻道設定錯誤的話，不能讓它害其他頻道每 30 分鐘重複收到同一則公告
      if (results.some(Boolean)) {
        await markAnnounced(games);
        console.log(`已公告 Steam 限時免費: ${games.map((g) => g.title).join(", ")}`);
      }
    }

    await pruneAnnounced(candidates, new Date());
  } catch (error) {
    // 抓不到候選清單就等下一輪，不清任何紀錄
    console.error("檢查 Steam 限時免費時發生錯誤:", error);
  } finally {
    checking = false;
  }
}

// 開機立刻檢查一次，之後每 30 分鐘檢查一次
export function startSteamFreeGameAlerts(client: Client): void {
  const channelIds = resolveAnnounceChannelIds();
  if (channelIds.length === 0) return;

  checkAndAnnounce(client, channelIds);
  setInterval(() => checkAndAnnounce(client, channelIds), CHECK_INTERVAL_MS);
}
