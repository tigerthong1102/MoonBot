import { describe, expect, it } from "vitest";
import { workBotName, workBotTopic } from "./work-bot-offer.ts";

describe("main chat work suggestions", () => {
  it.each([
    ["Tôi cần theo dõi tiến độ kiểm kho mỗi tuần.", "Kiểm kho", "box"],
    ["Lập kế hoạch cho chiến dịch tháng tới.", "Lịch nội dung", "calendar"],
    ["Please track outstanding invoices every week.", "Invoice tracking", "ledger"],
    ['Theo dõi dự án “Sao Mai” trong quý này.', "Sao Mai", "tasks"],
    ["Giúp mình theo dõi các hồ sơ ứng tuyển mỗi tuần.", "Hồ sơ ứng tuyển", "tasks"],
    ["Theo doi khach hang moi tuan", "Theo dõi khách hàng", "chart"],
  ])("recognizes %s without a provider", (text, name, icon) => {
    expect(workBotTopic(text)).toMatchObject({ name, icon, instructions: expect.stringContaining(text) });
  });

  it.each(["Xin chào", "Hóa đơn là gì?", "Đừng theo dõi hóa đơn", "Create a bot to track invoices",
    "What is inventory tracking?", "Tôi không muốn theo dõi hóa đơn nữa", "Please stop monitoring inventory", "Do not monitor sales", "Nhắc tôi uống nước mỗi ngày", ""])("skips %s", text => {
    expect(workBotTopic(text)).toBeNull();
  });

  it("offers a first specialist for a concrete one-off assignment", () => {
    expect(workBotTopic("Soạn báo giá cho khách hàng mới.", true)?.icon).toBe("chart");
    expect(workBotTopic("Soạn báo giá cho khách hàng mới.", false)).toBeNull();
  });

  it("redacts credentials before extracting names or instructions", () => {
    const secret = "sk-test-" + "a".repeat(32);
    const offer = workBotTopic(`Theo dõi dự án “${secret}” hàng tuần.`);
    expect(offer).not.toBeNull();
    expect(JSON.stringify(offer).toLowerCase()).not.toContain(secret.slice(0, 20));
  });

  it("matches equivalent Vietnamese display names across the roster", () => {
    expect(workBotName(" Kiểm   kho ", [{ name: "KIỂM KHO".normalize("NFD") }, { name: "Kiểm kho 2" }])).toBe("Kiểm kho 3");
    expect([...workBotName("Hồ sơ ".repeat(12), [])].length).toBeLessThanOrEqual(28);
  });
});
