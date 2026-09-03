# PRD v2.1

> 從 VS Code 本機編輯歷史（2025-06-13 的一次 AI 聊天紀錄）救回來的產品規劃文件，原本沒有存成專案檔案。

## 1. 功能範圍（2026-08-31 對照實際程式碼更新）

| 模組 | Slash 指令 | 功能摘要 |
| --- | --- | --- |
| RPG 核心 | `/rpg start` `/rpg profile` `/rpg inventory` `/rpg battle` `/rpg daily` `/rpg fish` `/rpg equip` `/rpg use` | 放置型戰鬥、經驗、金幣、裝備、釣魚小遊戲 |
| RPG 商店 | `/rpg shop` | 買賣道具（選單+按鈕操作，可選購買數量），賣價固定原價 50%；釣到的魚只能賣不能買 |
| 小遊戲 | `/random` `/rps` `/1a2b` | 猜數字（頻道共用）、剪刀石頭布、1A2B 猜數字（個人專屬） |
| 系統/工具 | `/ping` `/help` `/status`（Owner 限定） | 延遲測試、指令自動列表、手動改機器人顯示狀態 |
| ~~Gemini AI~~ | ~~`/ask <prompt>` `/ai chat`~~ | 已整個移除（2026-08-29 決定拔掉），不再是這個 bot 的功能範圍 |
| ~~管理 / QOL~~ | ~~`/config <module>` `/stats` `/restart`~~ | 從沒實作過，也不在任何路線圖裡，移出規劃範圍 |

**背景服務（非指令觸發，由事件監聽自動運作）：**

| 服務 | 觸發時機 | 功能摘要 |
| --- | --- | --- |
| 語音頻道自動簽到 | 使用者加入任一已設定的語音頻道 | 自動幫該使用者跑一次跟 `/rpg daily` 相同的簽到邏輯，並在指定頻道公告 |
| 語音頻道狀態輪替 | 每日台北時間換日 | 從詞庫隨機選一句話更新對應語音頻道的狀態文字 |
| 關鍵字彩蛋回覆 | 特定使用者發送訊息符合關鍵字規則 | 資料驅動的規則表，支援回覆文字/表情/延遲動作 |
| 每日資料庫備份 | 每日台北時間換日 | 見第 4 節「`prisma/dev.db` 單點故障風險」 |

## 2. 里程碑 & 驗收

| 里程碑 | 內容 | 驗收 |
| --- | --- | --- |
| S0 | 環境完成、Bot 上線 | `/help` 列出指令 |
| M1 | RPG 核心 `/rpg start /battle` + SQLite | 重啟後資料仍在 |
| M2 | `/daily /inventory /shop /equip`；升級公式 | 日常冷卻運作、購物能加道具 |
| ~~M3~~ | ~~`/ask` & `/ai chat` Thread 整合~~ | 已移除，AI 功能不再規劃 |
| ~~M4~~ | ~~Neon Free & GitHub Actions~~ | 已用其他方案取代，見下方調整點 |
| M5 | 崩潰通知（輕量版） | PM2 崩潰時打 webhook 通知到 Discord |
| ~~M6~~ | ~~Release 1.0（Docker Compose 一鍵部署）~~ | 不需要，見下方調整點 |

**調整點：**

- 原本 M2 的「/rank 排行榜」已移除；M2 現專注於經濟與道具系統。
- 若將來要加排行榜，可作 **M7** 擴充：只需新增 `/rank` 指令 + XP DESC 查詢（後續併入第 7 節路線圖的「排行榜」項目）。
- **M4 已用其他方案取代（2026-08-31）**：資料庫從頭到尾都是 SQLite，沒有換成 Neon（Postgres）；部署也不是走 GitHub Actions CI，而是 Oracle Cloud VM + 主機端 cron 輪詢 `git pull` 自動部署（見「伺服器部署」相關紀錄）。
- **M5 降級（2026-08-31）**：完整的 Winston + Sentry 監控對 2 人用的 bot 太重，降級成「PM2 崩潰時發 webhook 通知到 Discord」這種輕量版本；PM2 本身已經會自動重啟，只是還不會主動通知人。
- **M6 標記不需要（2026-08-31）**：bot 是直接裝 Node.js 跑在單一台 VM 上、PM2 常駐，不是容器化部署；用 Docker Compose 包起來對這個規模只有額外複雜度，沒有實質好處。

## 3. 資料模型（2026-08-31 更新，改為指向唯一事實來源）

Schema 從 M2 開始已經改了好幾次（新增 `effectType`、`rarity`、`lastFish` 等），這裡不逐欄位複製一份清單——那份清單只會再度跟實際 schema 脫節。**實際欄位定義一律以 [`prisma/schema.prisma`](prisma/schema.prisma) 為準**，改 schema 時不用回來同步更新這裡。

現有的模型：`User`（角色狀態、各種 `lastXxx` 冷卻時間戳記）、`Item`（含 `type`/`rarity`/`effectType`/`effectValue`）、`Inventory`（使用者與道具的多對多、含數量）、`EquippedItem`（四個裝備欄位）。相關設計決策見 [ADR 0001](docs/adr/0001-effective-stats-computed-not-stored.md)、[ADR 0002](docs/adr/0002-item-effect-type-field.md)。

## 4. 風險與非功能性需求

- 「排名演算法成本」風險已隨 `/rank` 移除而不需考慮，其餘項維持。
- 性能、測試覆蓋、零成本目標不變（**測試覆蓋目前實際上是 0**，專案裡沒有任何自動化測試，這個目標從沒被實際推進過，先誠實記錄）。
- **`prisma/dev.db` 單點故障風險（2026-08-31 已緩解）**：資料庫只存在 Oracle VM 一份，機器或磁碟出問題會讓兩人進度全部消失。已實作 `backupService.ts`：每天用 `better-sqlite3` 的線上備份 API 產生快照、保留 7 天，並透過 Discord DM 私訊給 owner 做異地備份，不用另外接雲端儲存服務。

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

## 7. RPG 內容擴充路線圖（grilling 結論，2026-08-31）

參考 [nuorpg.com](https://nuorpg.com/docs/)（別人做的 Discord RPG bot）功能清單，挑出適合這個 2 人小型 bot 的部分，透過 `/grilling` 排出優先順序：

| 順序 | 功能 | 相依 | 開發成本 | 狀態 |
| --- | --- | --- | --- | --- |
| - | `/rpg fish` 釣魚 | 無 | 低 | ✅ 已完成（2026-08-30，見 `327e0cd`） |
| 1 | 採集 | 無 | 低 | ✅ 已完成：`/rpg gather`，跟釣魚同一套 pattern（冷卻 + 加權隨機材料）；順便把釣魚/採集都從「每個稀有度 1 種」擴充成「每個稀有度 3 種」，各 15 種魚/材料 |
| 2 | 排行榜 | 無 | 極低 | ✅ 已完成：`/rpg leaderboard`，依等級排序、同等級比經驗值，前三名有 🥇🥈🥉（即原本規劃的 M7） |
| 3 | 鍛造 | 採集/釣魚（要先有材料） | 中 | ✅ 已完成：`/rpg craft`，`Item` 新增 `purchasable`/`recipe`（JSON 配方）欄位，新增神話（mythic）稀有度，11 件雙屬性鍛造裝備（武器/防具各 3 件、飾品 5 件），數值高於商店最高階的傳說裝備。順便新增 `Item.effectType2`/`effectValue2`（第二種效果，只有神話裝備會用到）跟 4 種新屬性加成：爆擊率/閃避率（`battle()` 每回合機率生效）、金幣加成/經驗加成（套用到戰鬥、釣魚、採集、每日簽到的獎勵）。2026-09-01 新增 4 件跨欄位混合裝備（例如武器攻擊+防禦、飾品防禦+閃避），打破原本「每欄位固定搭配」的限制，讓玩家能依打法選裝備 |
| 4 | 地下城（進階戰鬥） | 建立在現有 `battle()` 上 | 中 | ✅ 已完成：`/rpg dungeon`，單指令連打 4 層、逐層變強、最後一層是加成過的 boss；生命值跨層延續不回滿，中途落敗保留已過關的獎勵，全破再加一筆完成獎勵；把 `battle()` 的回合模擬邏輯抽成共用的 `simulateCombat()`，兩邊共用同一套戰鬥規則（含爆擊/閃避） |
| 5 | 冒險/探索 | 建立在現有 `battle()` 上 | 中 | ✅ 已完成：grilling 後決定不新增指令，直接疊加進 `/rpg battle`——每次戰鬥還是 100% 照舊發生，打贏後才會另外擲兩個獨立骰子（35% 金幣/道具、20% 菁英怪，可能同時中），互不影響主戰鬥的數值。菁英怪對打一場一樣吃 `simulateCombat()`，輸了會把血量砍到有效上限 30%，是真的有風險的額外戰鬥 |
| 6 | 農場（種植→等待→收成） | 無 | 中高 | ⬜ 未開始（跟現有即時結果的 cooldown 模式不同，是「種下去要等」的延遲收成機制） |

**排序標準**：相依順序優先（有前置關係的先做前置），其餘按開發成本由低到高。

**明確不做的項目（原因）**：

- 職業殿堂、公會：2 人用的伺服器意義不大
- 幻化造型、銘文刻印、套裝共鳴：深度裝備系統，投入產出比低
- 夢境試煉：目前沒有終局內容可對接
- 體力系統：要等活動數量夠多才有意義，現在做只是徒增操作摩擦

## 8. 部署與維運架構（2026-08-31 補記）

Bot 24/7 跑在 Oracle Cloud「Always Free」的一台 VM 上，之前完全沒有文件記錄，這裡補上：

**主機規格**

- Shape：`VM.Standard.E2.1.Micro`（1 OCPU / 1GB RAM，x86），另外手動加了 2GB swap 應付 `npm install` 編譯時的記憶體高峰
- 系統：Ubuntu 24.04，region `ap-tokyo-1`
- 公用 IP：**臨時（Ephemeral）**，不是保留 IP——如果這台實例被刪除重建，IP 會換掉，需要重新設定 SSH 連線用的位址
- SSH 存取憑證（金鑰位置等）刻意不寫在這份公開文件裡，避免曝露在公開 repo

**程式碼與常駐執行**

- 專案 clone 在 `/home/ubuntu/dc-bot`（跟 GitHub repo `TimOuO/discord-bot` 的 `main` 分支同步）
- 用 **PM2** 常駐（process 名稱 `dc-bot`），已設定 `pm2 startup`（systemd）+ `pm2 save`，機器重開機會自動復原

**自動部署（`~/dc-bot/deploy.sh`，由 cron 每 5 分鐘觸發一次）**

```bash
git fetch origin main --quiet
# 比對本地 HEAD 跟 origin/main，一樣就直接結束，不用往下跑
git pull --ff-only origin main
npm install
npm run db:migrate        # prisma migrate deploy
npm run db:seed:fish      # 冪等 upsert，重複跑安全
npm run db:seed:gather    # 同上
npm run db:seed:highTier  # 同上
npm run db:seed:craft     # 同上
pm2 restart dc-bot
npm run deploy || echo "指令註冊失敗，下次部署會自動重試"   # 重新註冊 slash 指令，失敗不擋部署
```

- **加新的種子腳本時，別忘了同步加進這份文件跟 `deploy.sh`**：`db:seed:gather` 跟 `db:seed:craft` 兩次都漏加進 `deploy.sh`，導致新道具的資料一直沒進到 production 資料庫，直到玩家回報「看不到東西」才發現、事後手動補跑。之後每加一個 `db:seed:*` 腳本，這裡跟 `deploy.sh` 要一起改。
- `deploy.sh` 本身**不受版控**，只存在伺服器上（要改的話直接編輯後上傳，不透過 git pull 更新自己）
- `.env`、`prisma/dev.db` 都不進 git，是當初設定機器時用 `scp` 手動傳過去的；之後這台機器上的 `dev.db` 就是唯一正本，不會再被本地端的檔案覆蓋。**`.env` 加新變數時記得要重新 `scp` 同步到伺服器**，`git pull` 不會更新它
- **部署成功／失敗都會私訊通知**（2026-08-31 加）：`deploy.sh` 用 REST API（不需要常駐 gateway 連線）直接私訊 `BACKUP_DM_USER_ID`，成功顯示 `舊hash → 新hash`，失敗顯示卡在哪個步驟；靠 bash 的 `trap ... ERR` 攔截，跟備份用的是同一個收件人

**Log 查看方式**：見第 4 節備份說明旁；指令彙整在對話紀錄裡，之後可以直接問「幫我看 log」。

**多群組支援（2026-09-01 加）**：`GUILD_ID`、`DAILY_ANNOUNCE_CHANNEL_ID` 都支援逗號分隔多組，讓 bot 可以同時服務多個 Discord 伺服器（見 `src/config.ts`）；新增 `MESSAGE_TRIGGER_GUILD_ID`，把 `messageCreate.ts` 的關鍵字彩蛋鎖在單一伺服器，不會被同一位觸發使用者帶到其他伺服器或 DM。**RPG 資料本身沒有依伺服器隔離**——`User` 只用 Discord 使用者 ID 當唯一鍵，同一個帳號在所有加了這隻 bot 的伺服器裡共用同一份角色（等級、金幣、背包、排行榜都是全域的），這是刻意的設計，不是還沒做完的功能。

**還沒做、算是已知缺口**：VM 的建立過程（Console 點擊步驟）沒有腳本化，重建要重新手動跑一次；沒有自動化的「VM 健康檢查」告警（例如整台機器沒有回應時不會有人主動通知）。

## 9. 互動元件（按鈕/選單）擴充（grilling 結論，2026-08-31）

背景：`/rpg shop sell` 想支援「全部賣掉」，發現 Discord 的 Integer 參數沒辦法輸入文字，順勢討論出要用**按鈕**而不是指令參數處理這類「快捷操作」；接著擴大盤點了全部指令的回覆卡片，一併規劃。

**技術架構**：

- 所有按鈕/選單的 `customId` 直接編碼「誰能點、要做什麼」（例如 `inv_page:<userId>:<頁碼>`），不額外用記憶體存狀態——背包/商店資料本來就是即時查資料庫，只要知道「第幾頁」「哪個道具」就能重新算，機器人重啟也不會讓按鈕失效
- 每個按鈕/選單點擊都要檢查「點的人是不是當初下指令的人」，不是的話擋掉並提示（沿用 `interaction.user.id` 比對）
- `interactionCreate.ts` 要新增 `isButton()` / `isStringSelectMenu()` 的分派邏輯

**卡片盤點與決定**：

| 卡片 | 決定 | 備註 |
| --- | --- | --- |
| `/rpg battle` 結果 | ✅ 加「再戰一次」按鈕 | 驗證整套按鈕架構的第一步 |
| `/rpg fish` 結果 | ✅ 加「立即賣掉」按鈕 | 跟 shop sell 是同一套邏輯 |
| `/rpg shop sell` 結果 | ✅ 改成 embed + 加「全部賣掉」按鈕 | 原本是純文字回覆，這次順便改成 embed 風格統一 |
| `/rpg inventory` | ✅ 加換頁按鈕 + 下拉選單選道具 → 跳出「裝備／賣掉」按鈕 | 一則訊息最多 25 個按鈕，道具多會爆版，改用 Select Menu（單一元件可放 25 個選項）+ 換頁解決 |
| `/rpg shop list` | ✅ 加換頁按鈕 + 下拉選單選商品 → 跳出「購買」按鈕 | 同上，商品多的話也會超過按鈕上限 |
| `/rpg profile`、`/rpg start`、每日獎勵 embed、`/help` | ❌ 不加 | 沒有明顯值得重複觸發的操作 |

**實作順序**（由簡到繁，逐步驗收）：

1. ✅ `/rpg battle` 結果加「再戰一次」按鈕（`9bb160b`）
2. ✅ `/rpg fish` 結果加「立即賣掉」按鈕（`ccc53b3`）
3. ✅ `/rpg shop sell` 改成 embed + 加「全部賣掉」按鈕（`c1abe22`）
4. ⬜ `/rpg inventory` 換頁 + 選單 + 裝備/賣掉快捷操作
5. ✅ `/rpg shop list` 換頁 + 選單 + 購買快捷操作（路線圖 5 步全部完成）

**額外決定（同一次討論一併提出）**：卡片要顯示下指令的人的頭像（用 `EmbedBuilder.setAuthor` 帶 `iconURL`，之後每張新卡片都比照辦理）。

## 10. 經驗值/金幣步調分析（2026-08-31）

背景：經驗曲線改成平方成長後，順勢確認戰鬥經驗、簽到金幣這些「獎勵公式」有沒有跟著配平，還是完全脫節。實際算出數字後，發現**現有公式沒有特別為了新曲線調整過，但巧合地方向是對的**，決定不改公式，只把分析記錄下來（之後如果要調，這裡就是基準）。

**戰鬥經驗 vs 升級門檻**：`enemyLevel` 本來就跟著玩家等級走，所以「升一級平均要打幾場」本來就會隨等級增加，且會收斂、不會無限發散：

| 區間 | 門檻差距 | 平均每場經驗 | 平均要打幾場 |
| --- | --- | --- | --- |
| Lv1→Lv2 | 150 | 21.0 | 7.1 場 |
| Lv5→Lv6 | 550 | 41.0 | 13.4 場 |
| Lv10→Lv11 | 1050 | 66.0 | 15.9 場 |
| Lv18→Lv19 | 1850 | 106.0 | 17.5 場 |
| Lv30→Lv31 | 3050 | 166.0 | 18.4 場 |

**簽到金幣 vs 裝備售價**：`goldMultiplier`（隨等級線性）跟 `goldBonus`（也隨等級線性）相乘，意外變成二次成長，越高等級越容易負擔高階裝備：

| 等級 | 平均每天簽到金幣 | 買 rare（470金） | 買 epic（1070金） | 買 legendary（2770金） |
| --- | --- | --- | --- | --- |
| Lv1 | 57 | 8.2 天 | 18.8 天 | 48.6 天 |
| Lv10 | 150 | 3.1 天 | 7.1 天 | 18.5 天 |
| Lv18 | 266 | 1.8 天 | 4.0 天 | 10.4 天 |
| Lv30 | 500 | 0.9 天 | 2.1 天 | 5.5 天 |

**結論**：兩條曲線都已經大致符合「越高等級練功越慢、但買裝備越輕鬆」的方向，維持現狀。

## 11. 戰鬥公式改成百分比減傷（2026-09-01）

**背景**：玩家反映裝備堆滿傳說等級後，地下城跟一般戰鬥都「沒什麼難度」。查了 production 實際資料（兩位玩家 Lv23/27，都已經穿滿商店最高階傳說裝備）發現真正原因：舊公式是直接相減（`傷害 = 攻擊 - 防禦`，保底 1 點），只要防禦超過敵人攻擊力就會被徹底碾平、每回合固定只吃 1 點傷害——不是裝備不夠強，而是防禦一旦反超攻擊，這個公式就完全喪失意義，之後裝備再怎麼升級都會重蹈覆轍。

**改動**：

- `simulateCombat()` 改用百分比減傷公式：`傷害 = 攻擊 * 100/(100+防禦)`，防禦只會「減傷」不會「完全免疫」，不管數值堆多高都不會再出現碾平問題。
- 打贏一場戰鬥的回血從舊版固定 `+10` 改成「有效上限的 15%」——舊的固定值是為了配合舊公式的低傷害設計的，換新公式後傷害動輒幾十到上百點，固定 +10 早就沒意義了。
- 地下城 boss（第 4 層）跟菁英怪兩個「額外強化」的倍率也重新調校過（boss 血量/攻擊 ×1.55/×1.33，菁英怪 ×2.0/×1.5），目標是讓 Lv27 傳說裝備打地下城全破機率落在 5 成左右（不是穩贏也不是穩輸），菁英怪維持在 2-3 成、感覺是「真的有風險的額外戰鬥」。用 production 玩家的真實數值（Lv27、屠龍劍+龍鱗甲+不死鳥之心+生命寶石）實測校準。

## 12. 商店/背包互動再優化（grilling 結論，2026-09-02）

**背景**：玩家回報 5 個介面問題：① 商店一次只能買 1 個，② 使用道具的選單顯示庫存數量（例如「x3」）容易誤會成會用掉 3 個，但其實只用 1 個，③「全部賣掉」的字面容易誤會裝備中的也會賣掉，④ 飾品欄位只顯示有裝的，看不出來還有幾格是空的，⑤ 商店部分畫面缺少屬性數值。

**決定與改動**：

- **移除 `/rpg shop buy`、`/rpg shop sell` 兩個指令**，`/rpg shop` 從 subcommand group 降級成單一 plain subcommand（原本是 `/rpg shop list`），買賣全部改用選單 + 按鈕操作。原本 `shop.ts` 整個刪除，`shopList.ts` 改名成 `shop.ts`；customId 前綴從 `shoplist_*` 統一改成 `shop_*`。
- `ItemService.buyItem()` / `useItem()` 都加上 `amount` 參數（預設 1，向下相容）。`useItem` 會自動把 `amount` 封頂在「回滿血量所需的瓶數」，選多了也不會浪費藥水（例如缺 10 點血、選了 5 瓶回血藥，實際只會用掉剛好回滿的那 1 瓶），回傳的 `usedAmount`/`requestedAmount` 讓呼叫端可以告知玩家「其餘沒有浪費」。`/rpg use` 指令新增可選的 `amount` 選項；`/rpg inventory` 的「使用」按鈕也比照商店加上數量按鈕。
- **購買、使用、賣出三個動作都統一改成「加減按鈕（-5/-1/+1/+5）＋確認鍵」的數量選擇模式**：`/rpg shop` 選商品後可以選數量再購買；`/rpg inventory` 選藥水後可以選數量再使用；賣出原本只規劃「全部賣掉」單一操作，後來玩家追問「不能選數量賣嗎」，追加改成賣出數量選擇器，預設值＝目前可賣的最大數量（不調整就等於原本的「賣光」），可以往下調整保留幾個不賣。`ItemService.getSellableQuantity()` 從 private 改成 public，賣出按鈕/選擇器的數量上限直接排除裝備中的部分，全部都裝備中時顯示停用的「全部賣掉（裝備中，無法賣）」按鈕。
- **customId 編碼方式的教訓**：一開始三個數量選擇器都把「夾好範圍的目標值」直接編進按鈕的 customId（例如 `qty=2` 時 `-5`／`-1` 都會被夾到 `1`），數量接近上下限時兩顆按鈕會算出同一個目標值、custom_id 撞成重複，Discord 直接拒收整張卡片（互動會直接失敗，且很難從純看程式碼發現，是實際送一張假資料的卡片去 Discord API 測試時才踩到的）。修正方式：customId 一律改成帶「目前數量＋位移量」（例如 `qty:2:-5`），實際目標值交給按下去之後的 handler 用 `currentQty + delta` 算、再夾範圍，三個按鈕的位移量本來就互不相同，永遠不會撞。
- `/rpg inventory` 的裝備欄「飾品」那行改成固定列出 3 格（含「（空）」佔位），並在標題加上「（N/3）」，不會再因為只裝了 1、2 件就讓人以為飾品欄只有那麼多格；同時補上原本沒有顯示的金幣欄位。
- `/rpg shop` 的下拉選單選項加上效果數值（原本只有名稱+價格）。

## 13. 修掉「查完再寫」的競態問題（2026-09-03）

**背景**：另一個 AI 給了 7 點程式碼健檢建議，逐條查證後發現其中 2 點的診斷本身有誤（詳見下方「查證後修正」），這裡先處理已確認、風險/成本比最划算的兩點：冷卻/資源檢查的競態、每日備份失敗不重試。其餘 5 點（lockfile 版本、部署 gate、build 流程、README、CONTEXT.md 欄位數）留到之後的批次再做。

**問題**：`battle`/`dungeon`/`fish`/`gather`/`claimDaily` 都是「先讀 `lastX` 判斷冷卻/是否已簽到、算完獎勵才寫回」，`buyItem`/`sellItemQuantity` 是「先讀金幣/庫存數量判斷夠不夠、算完才扣」。這中間有空窗——連點兩下「再戰一次」按鈕，兩個請求都可能讀到「還沒過冷卻」通過檢查，兩邊都真的打了一場；`buyItem` 同理可能被連點扣成負數金幣。

**改法**：把「檢查」跟「寫入」包進同一個 conditional update，讓資料庫自己做原子判斷（兩種手法的取捨見 [ADR 0003](docs/adr/0003-cooldown-and-resource-races-use-conditional-updates.md)）：

- `battle`/`dungeon`/`fish`/`gather`：**先搶冷卻**——一開始就用 `updateMany({ where: { id, OR: [{ lastX: null }, { lastX: { lt: cutoff } }] }, data: { lastX: now } })`，`count === 0` 就是搶輸、還在冷卻。代價是萬一搶到之後中途出錯，冷卻會被吃掉——但這幾個冷卻只有 30 秒～5 分鐘，可以接受。
- `claimDaily`：**不能用搶的**（一次失敗就是損失一整天），改成把「今天還沒領」的條件（`lastDaily: null` 或 `lastDaily < 今天台北時間 00:00`）跟金幣/經驗/連續天數的寫入包在同一個 conditional update 裡，要嘛整包成立、要嘛整包不動；`count === 0` 就回傳「已經領過」。順帶解決了語音自動簽到跟手動 `/rpg daily` 幾乎同時觸發時可能兩邊都發獎勵的問題。
- `buyItem`：`updateMany({ where: { id, gold: { gte: 總價 } }, data: { gold: { decrement: 總價 } } })`，`count === 0` 才回頭查目前金幣組錯誤訊息；整個包進 interactive transaction，跟背包寫入要嘛一起成功要嘛一起回滾。
- `sellItemQuantity`：`updateMany({ where: { id, quantity: { gte: 數量 + 裝備中數量 } }, data: { quantity: { decrement: 數量 } } })`，扣完用 `deleteMany({ quantity: { lte: 0 } } })` 清掉歸零的庫存列，不留 `x0` 殘影。
- 併發測試：`Promise.allSettled`/`Promise.all` 同時發兩個請求，斷言恰好一個成功、金幣/庫存不會被灌成兩倍或扣成負數。SQLite 單一寫入行程的特性讓這類測試可以穩定重現，不是機率性的 flaky test。

**備份失敗不重試/不通知**：`lastBackupDate` 原本設在 `try` 外面，備份或私訊失敗當天就不會再嘗試，`catch` 也只有 `console.error`。改成只有成功才設 `lastBackupDate`（失敗的話下一輪 15 分鐘後再試），並加上「同一天只私訊通知一次失敗」的旗標避免連續失敗洗版；失敗時順便刪掉可能寫一半的殘留備份檔。

**查證後修正**（原始建議裡診斷有誤或會造成破壞的部分，先記錄、還沒動手）：

- lockfile 問題：不是「lockfile 過期」，是 `.gitignore` 直接排除了 `package-lock.json`，而版控裡躺的是 2025-06 就沒在用的 `pnpm-lock.yaml`（`@google/generative-ai`/lavalink/discord-player 都在裡面）。正確修法是把 `package-lock.json` 從 `.gitignore` 移除並 commit、砍掉 `pnpm-lock.yaml`，不是單純重跑一次 install。
- `package.json` 的 `prepare` 拆分：VM 上 PM2 實際跑的是編譯後的 `dist/index.js`，但 `deploy.sh` 完全沒有獨立的 build 步驟——build 目前是靠 `npm install` 觸發 `prepare` 產生的。若照原始建議直接拆掉 `prepare` 改成 `postinstall: prisma generate`，`deploy.sh` 會繼續 `pm2 restart` 舊的 `dist/`，而且部署通知還是會顯示成功，是一次無聲的生產環境退化。要做的話必須先在 `deploy.sh` 補上明確的 `npm run build` 並驗證過，才能動 `package.json`。

## 目前進度對照（2026-08-29 更新）

| 里程碑 | 狀態 | 備註 |
| --- | --- | --- |
| S0 | ✅ | Bot 可上線；`/help` 已完成，會依實際載入的指令自動列出說明，並依權限隱藏管理員專用指令 |
| M1 | ✅ | `/rpg start`、`/battle` + SQLite 已完成 |
| M2 | ✅ | `/daily`、`/shop`（買/賣）、`/inventory`、`/equip`、`/use` 皆已完成，並通過端對端測試；`/battle` 已改用裝備加成後的有效屬性計算傷害 |
| ~~M3~~ | ❌ 已移除 | `/ai`、Gemini 服務、`@google/generative-ai` 依賴全部拔掉，`GEMINI_API_KEY` 不再是啟動必要條件 |
| ~~M4~~ | ❌ 已用其他方案取代 | 改用 Oracle Cloud VM（SQLite + PM2 + cron 輪詢自動部署），沒有用到 Neon 或 GitHub Actions |
| M5 | ⬜ 未開始（已降級） | 範圍縮小為「PM2 崩潰時 webhook 通知」，還沒實作 |
| ~~M6~~ | ❌ 標記不需要 | 已直接部署在 VM 上正常運作，不需要 Docker 化 |
