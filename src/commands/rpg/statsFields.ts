import { sectionField, chip } from "../../utils/embeds";
import type { EffectiveStats } from "../../services/itemService";

/**
 * `/rpg profile` 跟 `/rpg inventory` 共用的「有效屬性」兩欄。
 *
 * 抽出來是因為兩張卡片顯示的本來就是同一組數字，各寫一份遲早會走鐘；
 * 也讓預覽腳本能拿到跟正式卡片一模一樣的欄位（卡片組成目前沒有測試覆蓋，
 * 地下城的「再次挑戰」按鈕就是這樣掉的）。
 *
 * 爆擊率、閃避率、金幣/經驗加成一直都在戰鬥與結算裡生效，只是以前沒有任何地方顯示，
 * 玩家得自己翻每件裝備的說明再心算。成就上線之後這四個數字也含成就給的部分。
 */
export function effectiveStatsFields(
  base: { attack: number; defense: number; maxHealth: number },
  effectiveStats: EffectiveStats
) {
  return [
    sectionField(
      "⚔️",
      "戰鬥數值",
      [
        `攻擊力 ${chip(effectiveStats.attack)}（基礎 ${base.attack}）`,
        `防禦力 ${chip(effectiveStats.defense)}（基礎 ${base.defense}）`,
        `生命上限 ${chip(effectiveStats.maxHealth)}（基礎 ${base.maxHealth}）`,
      ],
      true
    ),
    sectionField(
      "✨",
      // 不叫「裝備加成」了：成就上線之後這四個數字含成就給的部分（爆擊/閃避各有一份），
      // 掛著舊名字會讓玩家去翻每件裝備、然後算不出這個數字
      "額外加成",
      [
        // 四項固定都列，就算是 0 也不隱藏：欄位數固定，卡片高度才不會隨裝備變來變去，
        // 而且新手看得到「這裡有四個數字可以長」，比欄位憑空消失更有資訊
        `爆擊率 ${chip(`${effectiveStats.critRate}%`)}`,
        `閃避率 ${chip(`${effectiveStats.dodgeRate}%`)}`,
        `金幣 ${chip(`+${effectiveStats.goldBonus}%`)}`,
        `經驗 ${chip(`+${effectiveStats.xpBonus}%`)}`,
      ],
      true
    ),
  ];
}
