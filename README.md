# DC_Bot

一個 Discord 機器人：放置型 RPG 玩法（等級、金幣、裝備、戰鬥）+ 幾個小遊戲/工具指令。TypeScript + discord.js v14 + Prisma（SQLite）。

## 功能總覽

- **RPG**：`/rpg start`、`profile`、`inventory`、`battle`、`dungeon`、`fish`、`gather`、`craft`、`daily`、`leaderboard`、`use`、`shop`
- **小遊戲**：`/random`、`rps`、`1a2b`
- **系統/工具**：`/ping`、`help`、`status`（限機器人擁有者）
- **背景服務**（非指令觸發，由事件監聽自動運作）：語音頻道自動簽到、語音頻道狀態文字每日輪替、關鍵字彩蛋回覆、每日資料庫備份（私訊 DM 給指定使用者）

完整功能規劃、每個功能背後的決策紀錄見 [PRD.md](PRD.md)；領域詞彙見 [CONTEXT.md](CONTEXT.md)；架構決策記錄見 [docs/adr/](docs/adr/)。

## 環境需求

- Node.js（建議使用 LTS 版本）
- npm——這個專案的 lockfile 是 `package-lock.json`，**不要**用 pnpm/yarn 安裝套件（repo 裡另外躺著一份 `pnpm-lock.yaml`，那是舊的、已經沒在用，不要照它裝）

## 環境變數（`.env`）

`.env` 不進版控，需要自己在專案根目錄建立。

| 變數 | 必填 | 說明 |
| --- | --- | --- |
| `BOT_TOKEN` | 必填 | Discord 機器人的 Token（[Developer Portal](https://discord.com/developers/applications) → 你的 Application → Bot → Token） |
| `CLIENT_ID` | 註冊斜線指令時必填 | 機器人的 Application ID |
| `DATABASE_URL` | 必填 | SQLite 連線字串，例如 `file:./prisma/dev.db` |
| `GUILD_ID` | 選填 | 逗號分隔的伺服器 ID，例如 `111,222`。有設定就註冊「伺服器專屬指令」（近乎即時生效）；不設就退回「全域指令」（最多可能要等 1 小時才會顯示出來） |
| `MESSAGE_TRIGGER_USER_ID` | 選填 | 關鍵字彩蛋只對這位使用者的訊息生效；不設定整個功能就不會啟用 |
| `MESSAGE_TRIGGER_GUILD_ID` | 選填 | 關鍵字彩蛋只在這個伺服器生效，不會被同一位使用者帶到其他伺服器或 DM 觸發 |
| `DAILY_ANNOUNCE_CHANNEL_ID` | 選填 | 語音頻道自動簽到成功時要公告到哪個頻道。**格式**：`伺服器ID:頻道ID`，逗號分隔多組，例如 `111:333,222:444`（不同伺服器的頻道 ID 不能共用，要各自對應各自的伺服器） |
| `VOICE_STATUS_CHANNELS` | 選填 | 每日自動輪替狀態文字的語音頻道清單。**格式**：`頻道ID:詞庫名稱`，逗號分隔多組，例如 `111:cat,222:pigsLots`（詞庫實際內容在 `src/services/voiceStatusService.ts` 裡設定） |
| `BACKUP_DM_USER_ID` | 選填 | 每日資料庫備份要私訊給誰；不設定就不會執行備份 |

## 從零開始跑起來

1. `npm install`
2. 建立 `.env`，至少填 `BOT_TOKEN`、`CLIENT_ID`、`DATABASE_URL`（見上表，其餘都是選填）
3. `npm run db:migrate`（套用資料庫 schema）
4. 種子資料（道具/魚類/材料，用 upsert 寫入，重複執行也安全）：

   ```bash
   npm run db:seed:fish
   npm run db:seed:gather
   npm run db:seed:highTier
   npm run db:seed:craft
   ```

5. `npm run deploy`（向 Discord 註冊斜線指令）
6. 啟動機器人：開發用 `npm run dev`（改檔案自動重啟），單純跑起來用 `npm run start`

## 測試

- `npm test` — 跑一次所有測試（`vitest run`，會自動對 `prisma/test.db` 套用 migration）
- `npm run test:watch` — watch 模式
- `npm run test:typecheck` — 只做型別檢查，不編譯輸出

## 部署

正式環境跑在 Oracle Cloud VM 上，PM2 常駐、cron 輪詢 `git pull` 自動部署。完整架構、`deploy.sh` 內容、已知缺口見 [PRD.md 第 8 節](PRD.md#8-部署與維運架構2026-08-31-補記)。
