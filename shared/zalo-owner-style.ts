export const ZALO_OWNER_STYLE_PATH = "/api/ai-twin/zalo-owner-style";
export const OWNER_STYLE_TRAITS = ["brief", "list", "question", "polite", "em", "minh", "toi"] as const;
export type OwnerStyleTrait = typeof OWNER_STYLE_TRAITS[number];
export interface ApprovedOwnerStyle {
  provenance: "owner-desktop-editor";
  traits: OwnerStyleTrait[];
  approvedAt: number;
}

export function localStyleExample(traits: readonly OwnerStyleTrait[]) {
  const person = traits.includes("em") ? "Em" : traits.includes("minh") ? "Mình" : traits.includes("toi") ? "Tôi" : "";
  const clause = person ? person + " đã nhận yêu cầu." : "Đã nhận yêu cầu.";
  const lead = traits.includes("polite") ? "Dạ, " + clause.charAt(0).toLowerCase() + clause.slice(1) : clause;
  const follow = traits.includes("question") ? "Bạn tiện trao đổi tiếp lúc nào?" : traits.includes("brief") ? "" : "Cảm ơn bạn đã trao đổi.";
  return [lead, follow].filter(Boolean).map(line => traits.includes("list") ? "• " + line : line).join(traits.includes("list") ? "\n" : " ");
}
