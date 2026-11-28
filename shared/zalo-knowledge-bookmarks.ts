export const ZALO_PRIVATE_KNOWLEDGE_PATH = "/api/zalo-official/private-knowledge";
export const ZALO_PRIVATE_KNOWLEDGE_MARKER = "[Cho phép lưu vào Bộ não thứ hai riêng của chủ bot]";

export interface ZaloKnowledgeItem {
  sourceId: string;
  grantId: string;
  conversationId: string;
  senderId: string;
  quote: string;
  timestamp: number;
  expires: number;
  saved: boolean;
  revision: string;
}
