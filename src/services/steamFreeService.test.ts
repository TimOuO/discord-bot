import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  pickCandidateAppIds,
  parseSteamStoreItem,
  CheapSharkDeal,
  SteamStoreItem,
  FreeGame,
} from "./steamFreeGames";
import {
  findUnannounced,
  markAnnounced,
  pruneAnnounced,
  resolveAnnounceChannelIds,
} from "./steamFreeService";
import { config } from "../config";
import prisma from "./dbService";

const DAY = 24 * 60 * 60 * 1000;

function deal(overrides: Partial<CheapSharkDeal>): CheapSharkDeal {
  return { salePrice: "0.00", normalPrice: "9.99", steamAppID: "100", ...overrides };
}

// 限時免費時的樣子：一般的付費方案、比它貴的合輯，加上一個 is_free_to_keep 的免費方案
// （購買選項的排列跟欄位照真實的 Steam 回應）
function storeItem(overrides: Partial<SteamStoreItem> = {}): SteamStoreItem {
  return {
    appid: 1687950,
    success: 1,
    name: "女神異聞錄5皇家版",
    type: 0,
    assets: { asset_url_format: "steam/apps/1687950/${FILENAME}?t=1", header: "header_tchinese.jpg" },
    purchase_options: [
      { packageid: 601219, original_price_in_cents: "179000", formatted_original_price: "NT$ 1,790.00" },
      { bundleid: 48129, original_price_in_cents: "331200", formatted_original_price: "NT$ 3,312.00" },
      {
        packageid: 999999,
        original_price_in_cents: "0",
        is_free_to_keep: true,
        free_to_keep_ends: 1790874000,
        free_to_keep_base_package: 601219,
      },
    ],
    ...overrides,
  };
}

function game(steamAppId: string): FreeGame {
  return parseSteamStoreItem(storeItem({ appid: Number(steamAppId), name: `Game ${steamAppId}` }))!;
}

describe("pickCandidateAppIds", () => {
  it("售價 0、原價大於 0 才是候選", () => {
    const ids = pickCandidateAppIds([
      deal({ steamAppID: "1" }),
      deal({ steamAppID: "2", salePrice: "0.99" }),
      // 本來就免費的遊戲不是限時免費
      deal({ steamAppID: "3", normalPrice: "0.00" }),
    ]);
    expect(ids).toEqual(["1"]);
  });

  it("沒有 Steam App ID 的略過，同一款遊戲只留一筆", () => {
    const ids = pickCandidateAppIds([
      deal({ steamAppID: null }),
      deal({ steamAppID: "7" }),
      deal({ steamAppID: "7" }),
    ]);
    expect(ids).toEqual(["7"]);
  });
});

describe("parseSteamStoreItem", () => {
  it("有 is_free_to_keep 選項的遊戲本體才算限時免費，名稱、原價、截止時間用台灣區的", () => {
    expect(parseSteamStoreItem(storeItem())).toEqual({
      steamAppId: "1687950",
      title: "女神異聞錄5皇家版",
      originalPrice: "NT$ 1,790",
      endsAt: new Date(1790874000 * 1000),
      storeUrl: "https://store.steampowered.com/app/1687950/",
      headerImageUrl:
        "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1687950/header_tchinese.jpg?t=1",
    });
  });

  it("原價取單買這款遊戲的方案，不是比較貴的合輯", () => {
    const withoutBasePackageHint = storeItem({
      purchase_options: [
        { bundleid: 48129, original_price_in_cents: "331200", formatted_original_price: "NT$ 3,312.00" },
        { packageid: 601219, original_price_in_cents: "179000", formatted_original_price: "NT$ 1,790.00" },
        { packageid: 999999, is_free_to_keep: true },
      ],
    });
    expect(parseSteamStoreItem(withoutBasePackageHint)?.originalPrice).toBe("NT$ 1,790");
  });

  it("Steam 省略 type 欄位時當成遊戲本體（0 是預設值）", () => {
    expect(parseSteamStoreItem(storeItem({ type: undefined }))).not.toBeNull();
  });

  it("DLC 不算", () => {
    expect(parseSteamStoreItem(storeItem({ type: 4 }))).toBeNull();
  });

  it("本來就免費的遊戲不算", () => {
    expect(parseSteamStoreItem(storeItem({ is_free: true }))).toBeNull();
  });

  it("只是打折、沒有 is_free_to_keep 選項的不算（例如只有美國區限時免費）", () => {
    expect(
      parseSteamStoreItem(
        storeItem({
          purchase_options: [{ original_price_in_cents: "179000", formatted_original_price: "NT$ 1,790.00" }],
        })
      )
    ).toBeNull();
  });

  it("台灣區查不到這款遊戲（例如鎖區）不算", () => {
    expect(parseSteamStoreItem({ appid: 1, success: 2 })).toBeNull();
  });

  it("沒有 free_to_keep_ends 就退回用折扣結束時間", () => {
    const g = parseSteamStoreItem(
      storeItem({
        purchase_options: [
          { original_price_in_cents: "179000", formatted_original_price: "NT$ 1,790.00" },
          { is_free_to_keep: true, active_discounts: [{ discount_end_date: 1790000000 }] },
        ],
      })
    );
    expect(g?.endsAt).toEqual(new Date(1790000000 * 1000));
  });

  it("兩種結束時間都沒有、也找不到原價時，還是算限時免費，只是這兩項留空", () => {
    const g = parseSteamStoreItem(storeItem({ purchase_options: [{ is_free_to_keep: true }] }));
    expect(g?.endsAt).toBeNull();
    expect(g?.originalPrice).toBeNull();
  });
});

describe("resolveAnnounceChannelIds", () => {
  const original = {
    steamFreeChannelIds: config.steamFreeChannelIds,
    dailyAnnounceChannelsByGuild: config.dailyAnnounceChannelsByGuild,
  };
  afterEach(() => Object.assign(config, original));

  it("沒設定 STEAM_FREE_CHANNEL_IDS 就跟著每個伺服器的簽到公告頻道", () => {
    config.steamFreeChannelIds = [];
    config.dailyAnnounceChannelsByGuild = new Map([
      ["guildA", "333"],
      ["guildB", "444"],
    ]);
    expect(resolveAnnounceChannelIds()).toEqual(["333", "444"]);
  });

  it("有設定 STEAM_FREE_CHANNEL_IDS 就只發到那些頻道", () => {
    config.steamFreeChannelIds = ["555"];
    config.dailyAnnounceChannelsByGuild = new Map([["guildA", "333"]]);
    expect(resolveAnnounceChannelIds()).toEqual(["555"]);
  });
});

describe("公告紀錄", () => {
  beforeEach(async () => {
    await prisma.announcedFreeGame.deleteMany();
  });

  it("公告過的遊戲不會再出現在待公告清單", async () => {
    await markAnnounced([game("1")]);

    expect(await findUnannounced(["1", "2"])).toEqual(["2"]);
  });

  it("重複標記同一款遊戲不會出錯", async () => {
    await markAnnounced([game("1")]);
    await expect(markAnnounced([game("1")])).resolves.toBeUndefined();
  });

  it("還在候選清單的遊戲，公告再久也不會被清掉", async () => {
    await markAnnounced([game("1")]);

    await pruneAnnounced(["1"], new Date(Date.now() + 30 * DAY));

    expect(await prisma.announcedFreeGame.count()).toBe(1);
  });

  it("剛公告不久就從清單消失的遊戲先保留，避免 API 暫時漏掉又重複公告", async () => {
    await markAnnounced([game("1")]);

    await pruneAnnounced([], new Date(Date.now() + 2 * DAY));

    expect(await prisma.announcedFreeGame.count()).toBe(1);
  });

  it("已經不在清單而且公告超過 7 天的紀錄會清掉，下次再限時免費時會重新公告", async () => {
    await markAnnounced([game("1")]);

    await pruneAnnounced([], new Date(Date.now() + 8 * DAY));

    expect(await findUnannounced(["1"])).toEqual(["1"]);
  });
});
