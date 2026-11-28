import { expect, it } from "vitest";
import { needsDesktop } from "../../apps/ai-pilot/mobile-desktop-task.mjs";
it.each([
  "Mở Excel",
  "Nhờ mở Excel",
  "Nhờ bạn mở MISA",
  "Hãy đối chiếu sổ sách trong MISA",
  "Nhập hóa đơn vào MISA",
  "Please open the file on my computer",
  "Update the totals in Excel",
])("routes a local operation before inference: %s", (prompt) =>
  expect(needsDesktop(prompt, "text")).toBe(true),
);
it.each([
  "Hướng dẫn tôi mở MISA",
  "Nhờ bạn hướng dẫn tôi mở Excel",
  "Viết công thức Excel tính thuế",
  "Explain how QuickBooks works",
  "Dịch tài liệu này sang tiếng Anh",
  "Lập kế hoạch chiến dịch",
])("keeps text work in standalone chat: %s", (prompt) => expect(needsDesktop(prompt, "text")).toBe(false));
it("respects explicit routing for other desktop-only tools", () =>
  expect(needsDesktop("Thực hiện trên ứng dụng nội bộ", "desktop")).toBe(true));
