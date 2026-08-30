import { EmbedBuilder, Message, ColorResolvable } from "discord.js";
import { config } from "../config";
import { ExtendedClient } from "../structures/ExtendedClient";

// 只有這位使用者發的訊息會觸發下面的關鍵字回應/小遊戲；沒設定 MESSAGE_TRIGGER_USER_ID 就整個不觸發
const TRIGGER_USER_ID = config.messageTriggerUserId;
const fat = `<@${TRIGGER_USER_ID}>`;

function getRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min) + min);
}

function getMora(x: number): number {
  return Math.floor(Math.random() * x);
}

export default (client: ExtendedClient): void => {
  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    if (message.author.id !== TRIGGER_USER_ID) return;
    if (!message.channel.isSendable()) return;

    const content = message.content;
    const lower = content.toLowerCase();

    if (content.includes("嗨") || content.includes("哈囉")) {
      await message.channel.send(`${message.author} 哈囉 😊 可以使用 / 指令呦~`);
      await message.react("🙌");
    } else if (content.includes("寶貝") || lower.includes("baby")) {
      await message.channel.send(`${message.author} 在呢`);
      await message.channel.send(
        "https://tenor.com/view/%E6%8A%B1-lift-cute-love-funny-gif-15526532"
      );
    } else if (lower.includes("breakup")) {
      await message.channel.send(`${message.author} 那可不行喔`);
      await message.channel.send(
        "https://tenor.com/view/couple-beat-smack-naughty-mochi-gif-16143239"
      );
    } else if (content.includes("跟你說喔")) {
      await message.channel.send(`說甚麼呢 🤔`);
      await message.channel.send(`${fat}很可愛呢 💜`);
      await message.react("❤️");
    } else if (content.includes("可愛")) {
      await message.channel.send(`誰可愛呀 🤔`);
      await message.channel.send(`${fat}可愛呢 ❤️`);
      await message.react("💜");
      await message.react("❤️");
      await message.react("🧡");
      await message.react("💛");
      await message.react("💚");
      await message.react("💙");
      await message.react("💗");
    } else if (
      content === "喔" ||
      content === "是喔" ||
      content.includes("ㄡ") ||
      content === "歐" ||
      content.includes("鷗鷗") ||
      content === "毆" ||
      content.includes("喔喔")
    ) {
      await message.channel.send(`${message.author}為什麼句點我 🥺`);
      await message.channel.send(
        "https://cdn.discordapp.com/attachments/967328542847275051/967328558701764618/unknown.png"
      );
      await message.react("🐽");
      await message.react("🐷");
    } else if (content.includes("哼") || content.includes("亨") || content.includes("😐")) {
      await message.channel.send(`${message.author}怎麼了呀`);
      await message.channel.send(`誰欺負妳我幫妳揍他 😤`);
    } else if (content.includes("被你氣死")) {
      await message.channel.send(`${message.author}是小仙女、小可愛`);
      await message.channel.send(`最好了對不對`);
      await message.channel.send(`對呢 ❤️`);
    } else if (content.includes("滾")) {
      await message.channel.send(`滾到妳的旁邊嘛?`);
      await message.channel.send(`沒問題呢😊`);
      await message.channel.send("滾地球一圈🌏🌍🌎🌏 我又回來了~");
    } else if (content.includes("臭胖")) {
      await message.channel.send(`講錯囉~ 是香胖歐 😊`);
    } else if (content.includes("蛤")) {
      await message.channel.send(`蛤蜊是對可食用的雙殼綱貝類的泛稱~ \n煮湯好喝 😋`);
    } else if (content.includes("死胖子") || content.includes("揍你")) {
      await message.channel.send(`${message.author}怎麼忍心 🥺 \n看在我幫妳按熊貓的份上`);
      await message.react("🐼");
    } else if (content.includes("憨")) {
      await message.channel.send(`肯定不是我呢 😀 \n但想幫妳按一個流口水`);
      await message.react("🤤");
    } else if (content.includes("掰") || content.includes("拜拜")) {
      await message.channel.send(`豈是你說掰就掰呀 \n回來喔 눈▂눈`);
      await message.channel.send(`\n\n\n\n\n\n\n\n\n\n好吧 👋 晚點見囉 ❤️`);
    } else if (content.includes("靠")) {
      await message.channel.send(`Cow 是牛喔~`);
      await message.react("🐄");
      await message.react("🦬");
      await message.react("🐂");
      await message.react("🐃");
    } else if (
      content === "胖胖" ||
      content === "呼呼" ||
      content === "胖子" ||
      content === "胖呼呼" ||
      content === "胖乎乎"
    ) {
      await message.channel.send(`怎麼了呀小肥 😀`);
    } else if (
      content.includes("變態") ||
      content.includes("欠打") ||
      content.includes("欠揍") ||
      content.includes("欠奏") ||
      content.includes("色鬼")
    ) {
      await message.channel.send(`誰!? Who!? 蝦郎!? 😮 \n肯定不是我 😉`);
    } else if (content.includes("不理你")) {
      await message.channel.send(`不要不理我拉~ 小肥 🥺`);
      await message.react("🐷");
    } else if (content.includes("不理我")) {
      await message.channel.send(`怎麼會不理你呢~ 小肥 ❤️`);
      await message.react("💜");
    } else if (content.includes("嘴邊肉")) {
      await message.channel.send(`${message.author}的特好捏呢 😊`);
      await message.react("🤏");
    } else if (
      content.includes("廁所") ||
      content.includes("洗澡") ||
      content.includes("🛀") ||
      content.includes("拉屎")
    ) {
      await message.channel.send(`好呢~ ${message.author}小心不要掉到馬桶喔~ 😉`);
    } else if (content.includes("~~") || content.includes("～～")) {
      await message.channel.send(`海帶呀海帶~ 海帶呀海帶~`);
    } else if (content.includes("鼻屎")) {
      await message.channel.send(`這個 No No 喔`);
      await message.react("❌");
    } else if (content.includes("🌚")) {
      await message.channel.send(`${message.author}太陽曬很多喔 😏 \n要記得擦防曬~ 👍`);
    } else if (content.includes("🌝")) {
      await message.channel.send(`${message.author}很棒呢 😊 \n有好好擦防曬~`);
    } else if (content.includes("晚上好")) {
      await message.channel.send(`晚上好的呢~`);
    } else if (content.includes("早上好")) {
      await message.channel.send(`早上好的🦆`);
    } else if (content.includes("嗚嗚")) {
      await message.channel.send(`🚂 嗚~嗚~ 寢強寢強~`);
    } else if (content.includes("等一下")) {
      await message.channel.send(`等兩下`);
    } else if (content.includes("人渣") || content.includes("敗類") || content.includes("垃圾")) {
      await message.channel.send(`皮諾可，這個直接電死 😡`);
      await message.channel.send(
        "https://cdn.discordapp.com/attachments/960812835837976576/967326967449931856/unknown.png"
      );
    } else if (
      content.includes("吃東西") ||
      content.includes("吃飯") ||
      content.includes("飯飯")
    ) {
      await message.channel.send(`${message.author} 看看你的肚肚 😀 \n 小心不要變這樣呦~`);
      await message.channel.send(
        "https://cdn.discordapp.com/attachments/967328542847275051/967329507646251088/unknown.png"
      );
      await message.react("🍕");
      await message.react("🍔");
      await message.react("🍟");
      await message.react("🌭");
      await message.react("🥞");
      await message.react("🥪");
      await message.react("🍗");
    } else if (lower.includes("mua") || lower.includes("kiss") || content.includes("親")) {
      await message.channel.send(
        "https://c.tenor.com/ufd0ItHQVaIAAAAC/mochi-mochimochi.gif"
      );
    } else if (content.includes("偷看")) {
      await message.channel.send("謀揪~ 我也要偷看呢 😶‍🌫️");
    } else if (content.includes("不要笑")) {
      await message.channel.send("噗 (裝沒事");
      await message.channel.send("可是會不小心忍不住 😺");
      await message.react("😺");
    } else if (content.includes("貓")) {
      await message.channel.send(
        "```\n　　　       　  ＿＿\n　    　　　　／＞　　 フ\n　   　 　　　|  　_　 _|\n　    　　　 ／` ミ＿꒳ノ\n　   　 　  /　　　 　|\n　   　　 /　 ヽ　　 ﾉ\n　    　 │　  |　|　|\n　   ／￣|　　|　|　|\n　  | (￣ ヽ＿_ヽ_)__)\n   　＼二つ\n```"
      );
      await message.react("🐈");
      await message.react("🐈‍⬛");
    } else if (
      content.includes("刀刀") ||
      content.includes("🔪") ||
      lower.includes("knife")
    ) {
      await message.channel.send(
        `這個是個危險的物品，幫 ${message.author} 收起來😘 \n 小肥最近累，幫小肥按摩`
      );
      await message.channel.send(
        "https://media.tenor.com/W12FJPalZMsAAAAC/massage-dudu.gif"
      );
      await message.react("❌");
      await message.react("🥺");
    }

    if (content === "小遊戲") {
      const littleGame = new EmbedBuilder()
        .setColor("#9b59b6" as ColorResolvable)
        .setTitle("小遊戲指令")
        .setDescription("輸入以下小遊戲的指令~")
        .addFields(
          { name: "​", value: "​" },
          { name: "`亂數`", value: "隨機獲得數字，去跟朋友比比大小吧~" },
          { name: "`猜拳`", value: "就是猜拳呢 😝" }
        );
      await message.channel.send({ embeds: [littleGame] });
    }

    if (content === "亂數") {
      await message.react("✅");
      const randomNumber = getRandomNumber(0, 1000);
      await message.reply(`你的數字是: ${randomNumber} 😝`);
    }

    if (content === "猜拳") {
      await message.react("✅");
      const randomMora = getMora(3);
      if (randomMora === 0) {
        await message.reply(`✌️`);
      } else if (randomMora === 1) {
        await message.reply(`✊`);
      } else if (randomMora === 2) {
        await message.reply(`🖐️`);
      }
    }
  });
};
