-- Steam 限免提醒：記下已經公告過的遊戲，重啟後不會重複公告。
-- 純新增一張表，不動既有資料。

CREATE TABLE "AnnouncedFreeGame" (
    "steamAppId" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "announcedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
