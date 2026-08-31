import { Message } from "discord.js";
import { randomInt } from "crypto";
import { config } from "../config";
import { ExtendedClient } from "../structures/ExtendedClient";

// 只有這位使用者、在這個伺服器發的訊息才會觸發下面的關鍵字回應；
// 沒設定 MESSAGE_TRIGGER_USER_ID / MESSAGE_TRIGGER_GUILD_ID 就整個不觸發，同一位使用者在其他伺服器或 DM 講也不會觸發
const TRIGGER_USER_ID = config.messageTriggerUserId;
const TRIGGER_GUILD_ID = config.messageTriggerGuildId;
const fat = `<@${TRIGGER_USER_ID}>`;

type SendText = string | ((message: Message) => string);

type Action =
  | { type: "send"; text: SendText }
  | { type: "react"; emoji: string }
  | { type: "wait"; ms: number };

interface KeywordRule {
  match: (content: string, lower: string) => boolean;
  // 每筆是一套完整的動作流程；只有一套 = 固定回覆，放多套才會隨機挑一套來執行
  variants: Action[][];
}

const send = (text: SendText): Action => ({ type: "send", text });
const react = (emoji: string): Action => ({ type: "react", emoji });
const wait = (ms: number): Action => ({ type: "wait", ms });

const includesAny = (s: string, ...needles: string[]) => needles.some((n) => s.includes(n));
const equalsAny = (s: string, ...values: string[]) => values.some((v) => s === v);

const rules: KeywordRule[] = [
  {
    match: (content, lower) => includesAny(content, "寶貝") || lower.includes("baby"),
    variants: [
      [
        send((m) => `${m.author} 在呢`),
        send("https://media.tenor.com/Sjj8yFV-u7gAAAAj/%E6%8A%B1-lift.gif"),
      ],
    ],
  },
  {
    match: (_content, lower) => lower.includes("breakup"),
    variants: [
      [
        send((m) => `${m.author} 那可不行喔`),
        send("https://media.tenor.com/vmgZEGne1n8AAAAj/couple-beat.gif"),
      ],
    ],
  },
  {
    match: (content) => content.includes("跟你說喔"),
    variants: [[send("說甚麼呢 🤔"), send(`${fat}很可愛呢 💜`), react("❤️")]],
  },
  {
    match: (content) => content.includes("可愛"),
    variants: [
      [
        send("誰可愛呀 🤔"),
        send(`${fat}可愛呢 ❤️`),
        react("💜"),
        react("❤️"),
        react("🧡"),
        react("💛"),
        react("💚"),
        react("💙"),
        react("💗"),
      ],
    ],
  },
  {
    match: (content) =>
      equalsAny(content, "喔", "是喔", "歐", "毆") ||
      includesAny(content, "ㄡ", "鷗鷗", "喔喔"),
    variants: [
      [
        send((m) => `${m.author}為什麼句點我 🥺`),
        send("https://media.tenor.com/DD81GVHbeiAAAAAi/bubu-dudu-sseeyall.gif"),
        react("🐽"),
        react("🐷"),
      ],
    ],
  },
  {
    match: (content) => includesAny(content, "哼", "亨", "😐"),
    variants: [[send((m) => `${m.author}怎麼了呀`), send("誰欺負妳我幫妳揍他 😤")]],
  },
  {
    match: (content) => content.includes("被你氣死"),
    variants: [
      [
        send((m) => `${m.author}是小仙女、小可愛`),
        send("最好了對不對"),
        send("對呢 ❤️"),
      ],
    ],
  },
  {
    match: (content) => content.includes("滾"),
    variants: [
      [
        send("滾到妳的旁邊嘛?"),
        send("沒問題呢😊"),
        send("滾地球一圈🌏🌍🌎🌏 我又回來了~"),
      ],
    ],
  },
  {
    match: (content) => content.includes("臭胖"),
    variants: [[send("講錯囉~ 是香胖歐 😊")]],
  },
  {
    match: (content) => content.includes("蛤"),
    variants: [[send(`蛤蜊是對可食用的雙殼綱貝類的泛稱~ \n煮湯好喝 😋`)]],
  },
  {
    match: (content) => includesAny(content, "死胖子", "揍你"),
    variants: [
      [send((m) => `${m.author}怎麼忍心 🥺 \n看在我幫妳按熊貓的份上`), react("🐼")],
    ],
  },
  {
    match: (content) => content.includes("憨"),
    variants: [[send("肯定不是我呢 😀 \n但想幫妳按一個流口水"), react("🤤")]],
  },
  {
    match: (content) => includesAny(content, "掰", "拜拜"),
    variants: [
      [
        send(`豈是你說掰就掰呀 \n回來喔 눈▂눈`),
        wait(3000),
        send("好吧 👋 晚點見囉 ❤️"),
      ],
    ],
  },
  {
    match: (content) => content.includes("靠"),
    variants: [[send("Cow 是牛喔~"), react("🐄"), react("🦬"), react("🐂"), react("🐃")]],
  },
  {
    match: (content) => equalsAny(content, "胖胖", "呼呼", "胖子", "胖呼呼", "胖乎乎"),
    variants: [[send("怎麼了呀小肥 😀")]],
  },
  {
    match: (content) => includesAny(content, "變態", "欠打", "欠揍", "欠奏", "色鬼"),
    variants: [[send("誰!? Who!? 蝦郎!? 😮 \n肯定不是我 😉")]],
  },
  {
    match: (content) => content.includes("不理你"),
    variants: [[send("不要不理我拉~ 小肥 🥺"), react("🐷")]],
  },
  {
    match: (content) => content.includes("不理我"),
    variants: [[send("怎麼會不理你呢~ 小肥 ❤️"), react("💜")]],
  },
  {
    match: (content) => content.includes("嘴邊肉"),
    variants: [[send((m) => `${m.author}的特好捏呢 😊`), react("🤏")]],
  },
  {
    match: (content) => includesAny(content, "廁所", "洗澡", "🛀", "拉屎"),
    variants: [[send((m) => `好呢~ ${m.author}小心不要掉到馬桶喔~ 😉`)]],
  },
  {
    match: (content) => includesAny(content, "~~", "～～"),
    variants: [[send("海帶呀海帶~ 海帶呀海帶~")]],
  },
  {
    match: (content) => content.includes("鼻屎"),
    variants: [[send("這個 No No 喔"), react("❌")]],
  },
  {
    match: (content) => content.includes("🌚"),
    variants: [[send((m) => `${m.author}太陽曬很多喔 😏 \n要記得擦防曬~ 👍`)]],
  },
  {
    match: (content) => content.includes("🌝"),
    variants: [[send((m) => `${m.author}很棒呢 😊 \n有好好擦防曬~`)]],
  },
  {
    match: (content) => content.includes("晚上好"),
    variants: [[send("晚上好的呢~")]],
  },
  {
    match: (content) => content.includes("早上好"),
    variants: [[send("早上好的🦆")]],
  },
  {
    match: (content) => content.includes("嗚嗚"),
    variants: [[send("🚂 嗚~嗚~ 寢強寢強~")]],
  },
  {
    match: (content) => content.includes("等一下"),
    variants: [[send("等兩下")]],
  },
  {
    match: (content) => includesAny(content, "人渣", "敗類", "垃圾"),
    variants: [
      [
        send("皮諾可，這個直接電死 😡"),
        send(
          "https://memeprod.sgp1.digitaloceanspaces.com/user-wtf/1593148838775.jpg"
        ),
      ],
    ],
  },
  {
    match: (content) => includesAny(content, "吃東西", "吃飯", "飯飯"),
    variants: [
      [
        send((m) => `${m.author} 看看你的肚肚 😀 \n 小心不要變這樣呦~`),
        send("https://media1.tenor.com/m/pNjz6uu8QDYAAAAd/foca-seal.gif"),
        react("🍕"),
        react("🍔"),
        react("🍟"),
        react("🌭"),
        react("🥞"),
        react("🥪"),
        react("🍗"),
      ],
    ],
  },
  {
    match: (content, lower) =>
      lower.includes("mua") || lower.includes("kiss") || content.includes("親"),
    variants: [[send("https://c.tenor.com/ufd0ItHQVaIAAAAC/mochi-mochimochi.gif")]],
  },
  {
    match: (content) => content.includes("偷看"),
    variants: [[send("謀揪~ 我也要偷看呢 😶‍🌫️")]],
  },
  {
    match: (content) => content.includes("不要笑"),
    variants: [[send("噗 (裝沒事"), send("可是會不小心忍不住 😺"), react("😺")]],
  },
  {
    match: (content) => content.includes("貓"),
    variants: [
      [
        send(
          "```\n　　　       　  ＿＿\n　    　　　　／＞　　 フ\n　   　 　　　|  　_　 _|\n　    　　　 ／` ミ＿꒳ノ\n　   　 　  /　　　 　|\n　   　　 /　 ヽ　　 ﾉ\n　    　 │　  |　|　|\n　   ／￣|　　|　|　|\n　  | (￣ ヽ＿_ヽ_)__)\n   　＼二つ\n```"
        ),
        react("🐈"),
        react("🐈‍⬛"),
      ],
    ],
  },
  {
    match: (content, lower) =>
      includesAny(content, "刀刀", "🔪") || lower.includes("knife"),
    variants: [
      [
        send((m) => `這個是個危險的物品，幫 ${m.author} 收起來😘 \n 小肥最近累，幫小肥按摩`),
        send("https://media.tenor.com/W12FJPalZMsAAAAC/massage-dudu.gif"),
        react("❌"),
        react("🥺"),
      ],
    ],
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runActions(message: Message, actions: Action[]): Promise<void> {
  if (!message.channel.isSendable()) return;

  for (const action of actions) {
    if (action.type === "send") {
      const text = typeof action.text === "function" ? action.text(message) : action.text;
      await message.channel.send(text);
    } else if (action.type === "react") {
      await message.react(action.emoji);
    } else {
      await sleep(action.ms);
    }
  }
}

export default (client: ExtendedClient): void => {
  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    if (message.author.id !== TRIGGER_USER_ID) return;
    if (message.guild?.id !== TRIGGER_GUILD_ID) return;

    const content = message.content;
    const lower = content.toLowerCase();

    const rule = rules.find((r) => r.match(content, lower));
    if (!rule) return;

    const variant = rule.variants[randomInt(0, rule.variants.length)];
    await runActions(message, variant);
  });
};
