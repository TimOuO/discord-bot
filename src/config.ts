import dotenv from "dotenv";
dotenv.config({ quiet: true });

if (!process.env.BOT_TOKEN) {
  throw new Error("缺少Discord機器人Token");
}

export const config = {
  token: process.env.BOT_TOKEN,
  clientId: process.env.CLIENT_ID,
  prefix: "!",
};
