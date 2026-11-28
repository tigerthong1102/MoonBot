export const ZALO_MODEL_RECIPES = {
  property: ["buy", "rent", "viewing", "listing"],
  accounting: ["invoice", "reconciliation", "documents"],
  management: ["approval", "task", "deadline"],
  commerce: ["order", "return", "complaint"],
  logistics: ["shipment", "deliveryAddress", "cod"],
  personal: ["appointment", "reminder", "reply"],
} as const;
export type ZaloModelRecipe = keyof typeof ZALO_MODEL_RECIPES;
export type ZaloFindingKind = typeof ZALO_MODEL_RECIPES[ZaloModelRecipe][number];
export type ZaloConversationKind = "unspecified" | "direct" | "group";
export const ZALO_MODEL_LINES = 8;
export const ZALO_MODEL_CHARS = 8_000;
export type ZaloModelLine = { line: number; text: string };
export type ZaloModelFinding = { kind: ZaloFindingKind; line: number; quote: string };
export type ZaloModelOffer = { token: string; provider: string; model: string };
