/**
 * 新手的「下一步」提示。
 *
 * 動機來自正式資料：兩個新加入的玩家（Lv3、Lv4）每天準時簽到、連續 4 天沒斷，
 * 卻分別有 3 天、1 天沒有戰鬥過。他們滿血、有錢、新手藥水一瓶都沒用過——
 * 也就是說他們沒有卡關、沒有被難度打退，只是沒有任何東西告訴他們接下來該做什麼。
 *
 * 這個模組是純規則、不碰資料庫（跟 combat.ts 同樣的做法），呼叫端負責把狀態查好餵進來。
 */

/** 這一級（含）以上完全不顯示提示。這是給新手認識循環用的，不是給老手的雜訊 */
export const NEW_PLAYER_HINT_MAX_LEVEL = 10;

/** 血量低到這個比例以下才提醒回血，不然每場小擦傷都在嘮叨 */
const LOW_HEALTH_RATIO = 0.4;

/** 超過這麼多小時沒戰鬥就提醒回來打一場 */
const IDLE_BATTLE_HOURS = 24;

export interface NewPlayerState {
  level: number;
  health: number;
  maxHealth: number;
  gold: number;
  /** 背包裡有沒有可以回血的藥水 */
  hasHealingPotion: boolean;
  /** 上次戰鬥時間；從來沒打過是 null */
  lastBattleAt: Date | null;
  /** 商店裡買得起、而且比身上這件更好的裝備（挑最貴的那件）；沒有就是 null */
  affordableUpgrade: { name: string; cost: number } | null;
  /** 有沒有試過釣魚或採集 */
  hasGathered: boolean;
}

/**
 * 回傳當下最值得提醒的那一件事，沒事可講就回傳 null。
 *
 * 刻意只回傳「一句」而不是列一整串待辦：新手看到五個選項跟看到零個選項一樣不會動，
 * 而且規則是有優先順序的——血快沒了就別叫他去逛街。
 */
export function nextStepHint(state: NewPlayerState, now: Date = new Date()): string | null {
  if (state.level >= NEW_PLAYER_HINT_MAX_LEVEL) return null;

  // 血量過低：能回血就先回血，沒藥水的話叫他去打架只是送死，改推簽到（簽到會回血）
  if (state.health < state.maxHealth * LOW_HEALTH_RATIO) {
    return state.hasHealingPotion
      ? "血量偏低，先用 `/rpg use 小型生命藥水` 回血再繼續戰鬥。"
      : "血量偏低又沒有藥水了，`/rpg daily` 簽到可以回滿血，也可以去 `/rpg shop` 補幾瓶。";
  }

  // 從來沒打過架——新手最容易停在這裡：領完新手包就不知道下一步了
  if (state.lastBattleAt === null) {
    return "還沒打過第一場！用 `/rpg battle` 出發，戰鬥是經驗和金幣的主要來源。";
  }

  // 買得起更好的裝備卻沒買。把名字和價格直接講出來，不要只丟一句「去逛商店」
  if (state.affordableUpgrade) {
    const { name, cost } = state.affordableUpgrade;
    return `你的 ${state.gold} 金幣夠買「${name}」（${cost} 金幣）了，用 \`/rpg shop\` 換裝會好打很多。`;
  }

  // 超過一天沒戰鬥。正式資料裡的流失就長這樣：每天來簽到、但不再戰鬥
  const idleHours = (now.getTime() - state.lastBattleAt.getTime()) / (60 * 60 * 1000);
  if (idleHours >= IDLE_BATTLE_HOURS) {
    return "有一陣子沒戰鬥了，`/rpg battle` 冷卻只有 30 秒，隨時可以再來幾場。";
  }

  // 沒試過另一條產出線
  if (!state.hasGathered) {
    return "試試 `/rpg fish` 和 `/rpg gather`，可以撈到賣錢的魚和鍛造用的材料。";
  }

  return null;
}
