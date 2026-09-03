# DC_Bot RPG

一個 Discord bot 裡的放置型 RPG 玩法：使用者透過斜線指令累積等級、金幣、道具，並可以裝備武器/防具影響戰鬥表現。

## Language

**基礎屬性 (Base Stat)**:
`User` 資料表上的 `attack`/`defense` 等欄位。只受角色等級（升級）影響，永遠不會被裝備直接修改。
_Avoid_: 當前攻擊力、總攻擊力（這些字面上容易讓人以為已經包含裝備加成）

**有效屬性 (Effective Stat)**:
實際用於戰鬥計算與顯示的數值：基礎屬性 + 目前所有已裝備道具的 `effectValue` 加總。不存進資料庫，每次需要時即時計算。
_Avoid_: 戰鬥力、實際攻擊力

**效果類型 (Effect Type)**:
`Item.effectType` 欄位，明確標示這件道具的 `effectValue` 要加在哪個屬性上。取代「靠 `Item.type` 猜是加攻擊還是加防禦」的隱含規則。有兩類：`attack`/`defense`/`maxHealth`/`heal` 是數值型（直接加在對應欄位上）；`critRate`/`dodgeRate`/`goldBonus`/`xpBonus` 是百分比型（爆擊率、閃避率、金幣加成、經驗加成），這四種**沒有對應的基礎屬性欄位**，一律從 0 開始、完全來自裝備。

**第二效果類型 (Secondary Effect Type)**:
`Item.effectType2`/`effectValue2` 欄位，只有神話（mythic）稀有度的鍛造裝備會用到，讓一件裝備能同時加成兩種不同屬性（例如武器同時加攻擊+爆擊率）。一般裝備這兩個欄位是 `null`。

**裝備欄位 (Equip Slot)**:
`EquippedItem.slot` 的值，代表一個可以裝備一件道具的位置。固定有五個：`weapon`、`armor`、`accessory1`、`accessory2`、`accessory3`。武器、防具各一格，飾品開放三格。三個飾品欄位對玩家來說沒有實質差異（純粹是系統內部用來分開存三件飾品），介面上一律只講「飾品」，不會暴露是哪一欄。
