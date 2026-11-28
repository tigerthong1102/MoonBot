export interface ZaloReplySource {
  grantId: string;
  accountId: string;
  senderId: string;
  conversationId: string;
  sourceId: string;
  sourceTime: number;
  sourceText: string;
  sourceExpires: number;
  accountHeld: boolean;
  delivery?: "acknowledged" | "unknown";
  receiptId?: string;
}

export interface ZaloReplyPreview {
  actionId: string;
  digest: string;
  expires: number;
  text: string;
  source: ZaloReplySource;
}
