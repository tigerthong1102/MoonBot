import { maskPickedBotUsernames } from "../shared/bot-username.ts";
import type { Message } from "./store.ts";

export function assertSelectedBotUsernames(message: Pick<Message, "role" | "text" | "botMentionIds">, botAllowed: (id: string) => boolean): void {
  if (message.role !== "user" || !message.text) return;
  for (const id of message.botMentionIds ?? []) {
    if (maskPickedBotUsernames(message.text, [id]) !== message.text && !botAllowed(id)) {
      throw Object.assign(new Error("A selected bot is no longer available in this conversation."), { status: 409, code: "bot_mention_unavailable" });
    }
  }
}
