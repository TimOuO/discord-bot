-- 地下城從「一次指令連打 4 層」改成「逐層決定要不要再下去」，
-- 一趟會跨越多次互動，所以需要一個地方存趟內的進度。
--
-- 純新增一張表，沒有任何資料搬移：既有玩家不受影響，
-- 沒有未完成趟的人就是這張表裡沒有他的列。

CREATE TABLE "DungeonRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "clearedFloors" INTEGER NOT NULL DEFAULT 0,
    "health" INTEGER NOT NULL,
    "maxHealth" INTEGER NOT NULL,
    "healthBefore" INTEGER NOT NULL,
    "goldPending" INTEGER NOT NULL DEFAULT 0,
    "xpPending" INTEGER NOT NULL DEFAULT 0,
    "lootPending" JSONB NOT NULL,
    "nextFloor" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DungeonRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 一個玩家最多一趟未完成的下潛
CREATE UNIQUE INDEX "DungeonRun_userId_key" ON "DungeonRun"("userId");
