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
`Item.effectType` 欄位，明確標示這件道具的 `effectValue` 要加在哪個屬性上（例如 `attack`、`defense`、`maxHealth`）。取代「靠 `Item.type` 猜是加攻擊還是加防禦」的隱含規則。

**裝備欄位 (Equip Slot)**:
`EquippedItem.slot` 的值，代表一個可以裝備一件道具的位置。固定有四個：`weapon`、`armor`、`accessory1`、`accessory2`。武器、防具各一格，飾品開放兩格。
