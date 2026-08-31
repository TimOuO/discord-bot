import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      // service 層測試打的是獨立的測試資料庫，不會碰到 prisma/dev.db，
      // 更不會碰到伺服器上真實玩家的資料
      DATABASE_URL: "file:./prisma/test.db",
    },
    globalSetup: "./test/globalSetup.ts",
    // 多個測試檔共用同一個 SQLite 檔案，關掉平行執行避免互相干擾
    fileParallelism: false,
  },
});
