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
