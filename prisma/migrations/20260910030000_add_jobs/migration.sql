-- 職業系統：Lv30 之後可以選一個職業，被動改變其中一個系統的規則。
--
-- 純新增欄位、全部可為 null 或有預設值，既有玩家不受影響（job 是 null = 沒有職業，
-- 所有被動的覆寫都會回到預設常數）。
--
-- 連戰用的兩欄（battleStreak / streakEliteFired）在第一階段還不會被寫入，
-- 一起加是為了避免血戰鬥神上線時再跑一次遷移。

ALTER TABLE "User" ADD COLUMN "job" TEXT;
ALTER TABLE "User" ADD COLUMN "jobChangedOnce" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "battleStreak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "streakEliteFired" BOOLEAN NOT NULL DEFAULT false;
