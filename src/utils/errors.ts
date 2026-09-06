/**
 * 「玩家做得到的正常結果」，不是程式出錯：冷卻中、材料不夠、還沒 /rpg start 過。
 *
 * 這些訊息一樣會顯示給玩家看，但**不會寫進錯誤 log**。
 * 動機來自實際狀況：正式環境的錯誤 log 有 39 筆紀錄、全部都是這種正常狀態
 * （37 筆冷卻、2 筆鍛造材料不足），每一筆還附著完整 stack trace。
 * 雜訊比是 39:0，真的出問題時會直接被埋掉。
 *
 * 判斷方式刻意用 instanceof 而不是比對訊息字串——訊息是要給玩家看的，
 * 會被改寫、會被翻譯，不能拿來當程式判斷的依據。
 */
export class PlayerNotice extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlayerNotice";
  }
}

export function isPlayerNotice(error: unknown): error is PlayerNotice {
  return error instanceof PlayerNotice;
}

/**
 * 統一的 catch 處理：回傳要顯示給玩家的訊息，順便決定這件事該不該記進錯誤 log。
 * 真正的錯誤照舊完整記錄（含 stack trace），玩家提示則安靜略過。
 */
export function describeCommandError(context: string, error: unknown): string {
  if (isPlayerNotice(error)) return error.message;

  console.error(`${context}:`, error);
  return error instanceof Error ? error.message : String(error);
}
