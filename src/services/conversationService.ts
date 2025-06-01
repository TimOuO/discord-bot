import { ChatSession } from "@google/generative-ai";

const conversations = new Map<
  string,
  {
    session: ChatSession;
    lastUpdated: Date;
  }
>();

const CONVERSATION_TIMEOUT = 30 * 60 * 1000;

setInterval(() => {
  const now = new Date();
  for (const [userId, conversation] of conversations.entries()) {
    if (
      now.getTime() - conversation.lastUpdated.getTime() >
      CONVERSATION_TIMEOUT
    ) {
      conversations.delete(userId);
    }
  }
}, 5 * 60 * 1000);

export { conversations };
