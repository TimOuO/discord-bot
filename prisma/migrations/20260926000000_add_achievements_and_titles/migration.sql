-- 成就與稱號系統。
--
-- 兩張新表 + User 上一個可為 null 的欄位，沒有任何資料搬移：既有玩家部署後
-- 第一次打開 /rpg profile 會被懶惰偵測補上他們早就達成的成就，不需要在遷移裡回填。
-- 刻意不回填，是因為條件判斷寫在 achievements.ts（會演進），寫死一份 SQL 版本遲早會跟它不一致。
--
-- UserAchievement 為什麼要存而不是每次重新推導，見 docs/adr/0005。

ALTER TABLE "User" ADD COLUMN "title" TEXT;

CREATE TABLE "UserAchievement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "achievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- unique 是併發防線：兩個指令同時偵測到同一個成就時，第二個會直接撞約束而不是寫出第二列
CREATE UNIQUE INDEX "UserAchievement_userId_key_key" ON "UserAchievement"("userId", "key");

CREATE TABLE "UserTitle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "purchasedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserTitle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 同一個稱號買兩次是白花錢，用約束擋掉
CREATE UNIQUE INDEX "UserTitle_userId_key_key" ON "UserTitle"("userId", "key");
