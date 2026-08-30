# PRD v2.1

> 從 VS Code 本機編輯歷史（2025-06-13 的一次 AI 聊天紀錄）救回來的產品規劃文件，原本沒有存成專案檔案。

## 1. 功能範圍

| 模組 | Slash 指令 | 功能摘要 |
| --- | --- | --- |
| RPG | `/rpg start` `/battle` `/daily` `/profile` `/inventory` `/shop` `/equip` | 放置型戰鬥、經驗、金幣、道具（已刪除 `/rank` 排名指令） |
| Gemini AI | `/ask <prompt>` `/ai chat` | 與 Gemini 互動、支援 Thread |
| 管理 / QOL | `/config <module>` `/stats` `/restart` | Owner 專用設定、健檢、錯誤 Embed |

## 2. 里程碑 & 驗收

| 里程碑 | 內容 | 驗收 |
| --- | --- | --- |
| S0 | 環境完成、Bot 上線 | `/help` 列出指令 |
| M1 | RPG 核心 `/rpg start /battle` + SQLite | 重啟後資料仍在 |
| M2 | `/daily /inventory /shop /equip`；升級公式 | 日常冷卻運作、購物能加道具 |
| M3 | `/ask` & `/ai chat` Thread 整合 | Thread 內多輪對話正常 |
| M4 | Neon Free & GitHub Actions | `prisma migrate deploy` OK；CI 綠燈 |
| M5 | 監控（Winston + Sentry）& Beta | 24 h 無 fatal；log 統計戰鬥次量 |
| M6 | Release 1.0 | Docker Compose 一鍵部署 |

**調整點：**

- 原本 M2 的「/rank 排行榜」已移除；M2 現專注於經濟與道具系統。
- 若將來要加排行榜，可作 **M7** 擴充：只需新增 `/rank` 指令 + XP DESC 查詢。

## 3. 資料模型

現有 `User` / `Item` schema 不變；排行榜只需額外查詢，不需新欄位，因此刪除並不影響資料表。

## 4. 風險與非功能性需求

- 「排名演算法成本」風險已隨 `/rank` 移除而不需考慮，其餘項維持。
- 性能、測試覆蓋、零成本目標不變。

## 5. 下一步（原始規劃）

1. `feature/rpg-core` 分支：完成 `/rpg start /battle`。
2. `feature/rpg-economy`：實作 `/daily /shop /equip /inventory`。
3. 繼續照 M3–M6 推進；若日後要加排行榜，再新開里程碑即可。

## 6. M2 詳細設計（grilling 結論，2026-08-29）

透過 `/grilling` 對 M2 經濟系統逐一過決策，最終定案如下：

- **有效屬性即時計算**：`User.attack`/`defense` 只代表基礎值，裝備加成不寫回去，戰鬥/顯示時才即時加總（見 [ADR 0001](docs/adr/0001-effective-stats-computed-not-stored.md)）。
- **道具類型擴充為四種**：`weapon`、`armor`、`potion`、`accessory`（新增，PRD 原本沒有，這次一併規劃種子資料）。
- **`Item` 新增 `effectType` 欄位**：`attack`/`defense`/`heal` 等，取代靠 `type` 猜屬性的隱含規則，四種類型統一套用同一套邏輯（見 [ADR 0002](docs/adr/0002-item-effect-type-field.md)）。
- **裝備欄位共四格**：`weapon`、`armor`、`accessory1`、`accessory2`。飾品裝備時系統自動選空格，兩格都滿則預設頂掉 `accessory1`；沒有手動指定欄位的選項。
- **不做 `/unequip`**：想清空欄位只能換裝其他道具間接達成。
- **藥水改用獨立的 `/use <道具>` 指令**消耗，不是 PRD 原本規劃的 `/inventory` 子指令（偏離原始 PRD 的指令清單，但範圍很小）。
- **`/shop` 支援買也支援賣**：賣價固定為原價 **50%**；若賣掉會讓庫存數量低於目前裝備所需（也就是會賣到正在裝備中的最後一件），系統拒絕並提示先換裝。
- **買/賣/使用一律 1 個單位**，不支援一次指定數量（使用者標註「先選 A」，之後可能重新考慮）。
- **商店不做等級鎖**：所有道具只要金幣夠就能買，沒有 `requiredLevel` 這類限制。

**未來構想（不在 M2 範圍內，先記錄）：**

- 怪物戰鬥勝利時掉落道具（目前 `/battle` 只給金幣跟經驗值，完全沒有掉落機制）。若要做，需要額外設計掉落機率、掉落表跟稀有度對應。

## 目前進度對照（2026-08-29 更新）

| 里程碑 | 狀態 | 備註 |
| --- | --- | --- |
| S0 | ✅ | Bot 可上線；`/help` 尚未實作 |
| M1 | ✅ | `/rpg start`、`/battle` + SQLite 已完成 |
| M2 | ✅ | `/daily`、`/shop`（買/賣）、`/inventory`、`/equip`、`/use` 皆已完成，並通過端對端測試；`/battle` 已改用裝備加成後的有效屬性計算傷害 |
| M3 | 🟡 進行中 | `/ai` 僅支援單輪問答，Thread 多輪對話尚未串接 |
| M4 | ⬜ 未開始 | 尚未設定 Neon / CI |
| M5 | ⬜ 未開始 | 尚未加入監控 |
| M6 | ⬜ 未開始 | `docker-compose.yml` 目前是空殼，尚無 `Dockerfile` |
