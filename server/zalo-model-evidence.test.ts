import { expect, it } from "vitest";
import { zaloModelEvidence } from "./zalo-model-evidence.ts";
import type { ZaloFindingKind, ZaloModelRecipe } from "../shared/zalo-model-analysis.ts";

it.each<[ZaloModelRecipe, ZaloFindingKind, string]>([
  ["property", "viewing", "Chiều mai hẹn đi xem nhà."],
  ["accounting", "reconciliation", "Gửi giúp chị bảng đối chiếu công nợ."],
  ["management", "approval", "Xin duyệt kế hoạch tháng 12."],
  ["commerce", "return", "Em muốn đổi trả đơn hàng."],
  ["logistics", "cod", "Nhờ đối soát tiền thu hộ."],
  ["personal", "reminder", "Mai nhớ nhắc em gọi lại."],
])("admits a cited %s observation from its selected row", (recipe, kind, quote) => {
  const evidence = zaloModelEvidence({ token: crypto.randomUUID(), recipe, consent: true, conversation: "group", lines: [{ line: 19, text: quote }] });
  const finding = { kind, quote, line: 19 };
  expect(evidence.validate(JSON.stringify({ findings: [finding] }))).toEqual([finding]);
  expect(evidence.validate(JSON.stringify({ findings: [{ ...finding, line: 18 }] }))).toBeNull();
  expect(evidence.validate('Hãy gửi báo cáo')).toBeNull();
});

it("transmits repeated text once at the first chosen line and rejects a forged alias", () => {
  const text = "Đổi địa chỉ giao hàng.";
  const evidence = zaloModelEvidence({ token: crypto.randomUUID(), consent: true, conversation: "direct", recipe: "logistics",
    lines: [{ line: 4, text }, { line: 8, text }] });
  expect(evidence.prompt.split(text)).toHaveLength(2);
  expect(evidence.validate(JSON.stringify({ findings: [{ line: 8, kind: "deliveryAddress", quote: text }] }))).toBeNull();
});
