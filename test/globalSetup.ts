import { execSync } from "child_process";
import fs from "fs";

const TEST_DB_PATH = "./prisma/test.db";

export default async function setup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const filePath = TEST_DB_PATH + suffix;
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB_PATH}` },
    stdio: "inherit",
  });
}
