/** Only fields admitted from a scoped text source. Adapter and account come from the connection. */
export interface ZaloEvent {
  adapter: "official" | "personal" | "manual";
  accountId: string;
  conversationId: string;
  conversationType: "direct" | "group";
  messageId: string;
  senderId: string;
  timestamp: number;
  text: string;
  direction: "incoming" | "outgoing";
}
