-- 裝備從「同名合併成一列 + 數量」改成「一件一列」的實體模型，為了讓每件裝備能有各自的強化等級。
-- 消耗品/魚/材料維持原本的 Inventory 堆疊，不受影響。
--
-- 遷移策略：裝備中的那幾件「直接沿用 EquippedItem 的 id 當作實體 id」，
-- 這樣新的 EquippedItem.itemInstanceId 就是它自己的 id，配對必然 1:1，
-- 不需要用 (userId, itemId) 去 JOIN 猜哪一列對應哪一件——配錯或漏配都會讓玩家掉裝備。

PRAGMA foreign_keys=OFF;

-- 1) 建立裝備實體表
CREATE TABLE "ItemInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "enhanceLevel" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ItemInstance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ItemInstance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ItemInstance_userId_idx" ON "ItemInstance"("userId");

-- 2) 先把「正在裝備中」的每一件各建一個實體，id 沿用 EquippedItem 的 id。
--    即使某件裝備的 Inventory 列不知為何不見了，這一步也保證它不會在遷移中消失。
INSERT INTO "ItemInstance" ("id", "userId", "itemId", "enhanceLevel", "createdAt", "updatedAt")
SELECT e."id", e."userId", e."itemId", 0, e."createdAt", CURRENT_TIMESTAMP
FROM "EquippedItem" e;

-- 3) 再把「擁有但沒裝備」的部分展開：每列補上 (數量 - 已裝備件數) 個實體。
--    用遞迴 CTE 把一列 quantity=N 展開成 N 列，uuid 用 SQLite 慣用的 randomblob 組法。
INSERT INTO "ItemInstance" ("id", "userId", "itemId", "enhanceLevel", "createdAt", "updatedAt")
WITH RECURSIVE remaining(userId, itemId, n, cnt, createdAt) AS (
    SELECT
        inv."userId",
        inv."itemId",
        1,
        inv."quantity" - (
            SELECT COUNT(*) FROM "EquippedItem" e
            WHERE e."userId" = inv."userId" AND e."itemId" = inv."itemId"
        ),
        inv."createdAt"
    FROM "Inventory" inv
    JOIN "Item" it ON it."id" = inv."itemId"
    WHERE it."type" IN ('weapon', 'armor', 'accessory')
    UNION ALL
    SELECT userId, itemId, n + 1, cnt, createdAt FROM remaining WHERE n < cnt
)
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || substr('89ab', 1 + (abs(random()) % 4), 1)
      || substr(lower(hex(randomblob(2))), 2) || '-'
      || lower(hex(randomblob(6))),
    userId, itemId, 0, createdAt, CURRENT_TIMESTAMP
FROM remaining
WHERE cnt > 0;

-- 4) EquippedItem 改成指向實體。SQLite 不能直接改欄位，照 Prisma 慣例重建整張表。
CREATE TABLE "new_EquippedItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "itemInstanceId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EquippedItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EquippedItem_itemInstanceId_fkey" FOREIGN KEY ("itemInstanceId") REFERENCES "ItemInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- itemInstanceId 直接等於原本 EquippedItem 的 id，因為第 2 步就是這樣建的
INSERT INTO "new_EquippedItem" ("id", "userId", "itemInstanceId", "slot", "createdAt", "updatedAt")
SELECT e."id", e."userId", e."id", e."slot", e."createdAt", CURRENT_TIMESTAMP
FROM "EquippedItem" e;

DROP TABLE "EquippedItem";
ALTER TABLE "new_EquippedItem" RENAME TO "EquippedItem";
CREATE UNIQUE INDEX "EquippedItem_itemInstanceId_key" ON "EquippedItem"("itemInstanceId");
CREATE UNIQUE INDEX "EquippedItem_userId_slot_key" ON "EquippedItem"("userId", "slot");

-- 5) 裝備已經全部搬到 ItemInstance，把 Inventory 裡的裝備列清掉，避免兩邊都有、之後對不起來
DELETE FROM "Inventory"
WHERE "itemId" IN (SELECT "id" FROM "Item" WHERE "type" IN ('weapon', 'armor', 'accessory'));

PRAGMA foreign_keys=ON;
