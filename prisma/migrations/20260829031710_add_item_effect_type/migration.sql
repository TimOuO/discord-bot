/*
  Warnings:

  - Added the required column `effectType` to the `Item` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "rarity" TEXT NOT NULL DEFAULT 'common',
    "cost" INTEGER NOT NULL,
    "effectType" TEXT NOT NULL,
    "effectValue" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Item" ("cost", "createdAt", "description", "effectValue", "id", "name", "rarity", "type", "updatedAt") SELECT "cost", "createdAt", "description", "effectValue", "id", "name", "rarity", "type", "updatedAt" FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
CREATE UNIQUE INDEX "Item_name_key" ON "Item"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
