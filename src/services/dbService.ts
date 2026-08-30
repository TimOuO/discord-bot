import dotenv from "dotenv";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma";

// 這個模組現在自己讀 process.env.DATABASE_URL（原本是交給 Prisma 內部處理），
// 所以不能依賴呼叫端事先載入 .env，這裡直接載入一次以確保萬用
dotenv.config({ quiet: true });

// 宣告全域變數以在熱重載時避免多個實例
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// Prisma 7 起不再從 schema.prisma 讀取 datasource url，改由 driver adapter 傳入
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });

// 建立單一實例
export const prisma = global.prisma || new PrismaClient({ adapter });

// 在非生產環境中，將 prisma 設為全域變數以避免熱重載時產生過多連接
if (process.env.NODE_ENV !== "production") global.prisma = prisma;

export default prisma;
