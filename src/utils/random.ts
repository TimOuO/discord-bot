// 全專案共用的亂數工具。原本專案裡混用兩套寫法：整數範圍用 crypto.randomInt、
// 機率判定有時候寫成 Math.random() < 機率、有時候寫成 randomInt(0, 100) < 百分比。
// 這裡統一成 Math.random 為底的兩個函式——遊戲的擲點數沒有防作弊/密碼學需求，
// crypto 等級的亂數是殺雞用牛刀（而且比較慢），統一之後「擲機率」也只剩一種寫法。

/** 回傳 [min, max) 範圍內的整數（max 不包含在內，跟原本 crypto.randomInt 的語意一致） */
export function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min));
}

/** 以 probability（0~1）的機率回傳 true，例如 randomChance(0.35) 就是 35% */
export function randomChance(probability: number): boolean {
  return Math.random() < probability;
}

/** 以 percent（0~100）的機率回傳 true，給爆擊率/閃避率這種本來就用百分比表示的數值用 */
export function randomPercentChance(percent: number): boolean {
  return Math.random() * 100 < percent;
}
