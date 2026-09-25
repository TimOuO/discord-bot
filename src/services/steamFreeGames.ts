// 找出 Steam 上現在「限時免費」的遊戲（定義見 CONTEXT.md），分兩步：
//
// 1. CheapShark 找候選：Steam 本身沒有公開的限時免費清單，CheapShark 會追蹤 Steam 商店的價格
//    （storeID=1 就是 Steam 商店本身），「售價 0、原價大於 0」的就是候選。
//    GamerPower 那類 giveaway 清單大多是第三方網站發的序號或 DLC，雜訊太多，不採用。
// 2. 跟 Steam 確認：CheapShark 的價格是美國區、名稱是英文，也不保證排除 DLC，更沒有結束時間。
//    Steam 的 IStoreBrowseService/GetItems 用台灣區、繁中查，確認是遊戲本體、台灣區有「is_free_to_keep」
//    的購買選項，順便拿中文名稱、新台幣原價、領取截止時間。
//    （原本用的 appdetails API 沒有結束時間，所以換成這個）

const CHEAPSHARK_DEALS_URL =
  "https://www.cheapshark.com/api/1.0/deals?storeID=1&upperPrice=0&pageSize=60";

const STEAM_GET_ITEMS_URL = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/";

const STEAM_ASSET_BASE_URL = "https://shared.fastly.steamstatic.com/store_item_assets/";

// CheapShark 會擋掉沒有自我介紹的 User-Agent
const USER_AGENT = "DC_Bot-SteamFree/1.0 (+https://github.com/TimOuO/discord-bot)";

const FETCH_TIMEOUT_MS = 15_000;

// Steam 的 EStoreAppType，0 是遊戲本體（4 是 DLC）
const STEAM_APP_TYPE_GAME = 0;

/** CheapShark deals API 回傳的欄位（只列用得到的，數字都是字串） */
export interface CheapSharkDeal {
  salePrice: string;
  normalPrice: string;
  steamAppID: string | null;
}

/** Steam GetItems 回傳的購買選項（只列用得到的；int64 的價格是字串） */
export interface SteamPurchaseOption {
  /** 單一方案（sub）的 ID */
  packageid?: number;
  /** 合輯的 ID；有這個的是合輯，不是單買這款遊戲 */
  bundleid?: number;
  original_price_in_cents?: string;
  formatted_original_price?: string;
  is_free_to_keep?: boolean;
  /** 限時免費的領取截止時間，unix 秒 */
  free_to_keep_ends?: number;
  /** 限時免費選項對應的原始付費方案 packageid */
  free_to_keep_base_package?: number;
  active_discounts?: { discount_end_date?: number }[];
}

/** Steam GetItems 回傳的一個商品（只列用得到的） */
export interface SteamStoreItem {
  appid?: number;
  /** 1 = 查得到；台灣區鎖區或不存在的遊戲不是 1 */
  success?: number;
  name?: string;
  /** EStoreAppType；值是預設的 0（遊戲）時 Steam 可能省略這個欄位 */
  type?: number;
  is_free?: boolean;
  assets?: { asset_url_format?: string; header?: string };
  purchase_options?: SteamPurchaseOption[];
}

export interface FreeGame {
  steamAppId: string;
  /** 台灣區商店顯示的名稱，有中文名就是中文 */
  title: string;
  /** 台灣區原價，例如「NT$ 1,790」；Steam 沒給就是 null */
  originalPrice: string | null;
  /** 領取截止時間；Steam 沒給就是 null */
  endsAt: Date | null;
  storeUrl: string;
  headerImageUrl: string;
}

/** 從 CheapShark 的清單挑出候選的 Steam App ID，同一個遊戲只留一筆 */
export function pickCandidateAppIds(deals: CheapSharkDeal[]): string[] {
  const ids = new Set<string>();
  for (const deal of deals) {
    if (!deal.steamAppID) continue;
    if (Number(deal.salePrice) !== 0 || !(Number(deal.normalPrice) > 0)) continue;
    ids.add(deal.steamAppID);
  }
  return [...ids];
}

/** Steam 確認：是遊戲本體、而且有限時免費的購買選項，才算限時免費；不是的話回傳 null */
export function parseSteamStoreItem(item: SteamStoreItem): FreeGame | null {
  if (item.success !== 1 || !item.appid || !item.name) return null;
  if ((item.type ?? STEAM_APP_TYPE_GAME) !== STEAM_APP_TYPE_GAME || item.is_free) return null;

  const options = item.purchase_options ?? [];
  const freeOption = options.find((o) => o.is_free_to_keep);
  if (!freeOption) return null;

  // 原價要找「單買這款遊戲」的價格。購買選項裡還混著合輯（有 bundleid），不能取最高價，
  // 那會抓到合輯的價格。依序取：限時免費選項本身的原價 → Steam 指定的原始方案 → 第一個非合輯的付費方案
  const hasPrice = (o: SteamPurchaseOption) => Number(o.original_price_in_cents) > 0;
  const plainPackages = options.filter((o) => o.packageid && !o.bundleid && hasPrice(o));
  const originalOption =
    (hasPrice(freeOption) ? freeOption : undefined) ??
    plainPackages.find((o) => o.packageid === freeOption.free_to_keep_base_package) ??
    plainPackages[0];

  const discountEnds = (freeOption.active_discounts ?? [])
    .map((d) => d.discount_end_date)
    .filter((t): t is number => !!t);
  const endsAtSeconds = freeOption.free_to_keep_ends || Math.max(0, ...discountEnds);

  const steamAppId = String(item.appid);
  const { asset_url_format: assetFormat, header } = item.assets ?? {};
  return {
    steamAppId,
    title: item.name,
    // Steam 給的是「NT$ 1,790.00」，台幣沒有小數，把 .00 拿掉
    originalPrice: originalOption?.formatted_original_price?.replace(/\.00$/, "") ?? null,
    endsAt: endsAtSeconds > 0 ? new Date(endsAtSeconds * 1000) : null,
    storeUrl: `https://store.steampowered.com/app/${steamAppId}/`,
    headerImageUrl:
      assetFormat && header
        ? STEAM_ASSET_BASE_URL + assetFormat.replace("${FILENAME}", header)
        : `${STEAM_ASSET_BASE_URL}steam/apps/${steamAppId}/header.jpg`,
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${url} 回應 ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/** CheapShark 上看起來是限時免費的 Steam App ID；網路錯誤或回應異常時丟錯 */
export async function fetchCandidateAppIds(): Promise<string[]> {
  const body = await fetchJson(CHEAPSHARK_DEALS_URL);
  // 被擋或限流時 CheapShark 會回 { error: "..." } 而不是陣列
  if (!Array.isArray(body)) {
    throw new Error(`CheapShark 回應格式不對: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return pickCandidateAppIds(body as CheapSharkDeal[]);
}

/**
 * 跟 Steam 確認哪些候選真的是限時免費，一次查一批。
 * 確認不是的直接不在回傳裡；查不到（網路錯誤、被限流）就丟錯，讓呼叫端下一輪再試，不能當成「不是」
 */
export async function verifyOnSteam(steamAppIds: string[]): Promise<FreeGame[]> {
  if (steamAppIds.length === 0) return [];

  const input = {
    ids: steamAppIds.map((id) => ({ appid: Number(id) })),
    context: { language: "tchinese", country_code: "TW" },
    data_request: { include_all_purchase_options: true, include_assets: true },
  };
  const url = `${STEAM_GET_ITEMS_URL}?input_json=${encodeURIComponent(JSON.stringify(input))}`;
  const body = (await fetchJson(url)) as { response?: { store_items?: SteamStoreItem[] } } | null;

  const items = body?.response?.store_items;
  if (!Array.isArray(items)) {
    throw new Error(`Steam GetItems 回應格式不對: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return items.map(parseSteamStoreItem).filter((g): g is FreeGame => g !== null);
}
