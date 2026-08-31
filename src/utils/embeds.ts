// 卡片排版風格共用工具：emoji｜標題 當欄位名稱（Discord 會自動加粗），
// 內容用 ▷ 子項目列表、數字用等寬格式框起來像標籤，參考別的 RPG bot 的卡片排版
export function sectionField(emoji: string, title: string, lines: string[]): { name: string; value: string } {
  return {
    name: `${emoji}｜${title}`,
    value: lines.map((line) => `▷ ${line}`).join("\n"),
  };
}

export function chip(value: string | number): string {
  return `\`${value}\``;
}

// 用愛心 emoji 組出生命值進度條，Discord embed 裡不能塞圖片型的進度條；
// 用 emoji 而不是 █░ 這類文字方塊，是因為文字方塊在不同字型下虛實大小不一致，emoji 是圖像渲染不會有這問題
export function progressBar(current: number, max: number, length = 10): string {
  const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  const filled = Math.round(ratio * length);
  return "❤️".repeat(filled) + "🤍".repeat(length - filled);
}
