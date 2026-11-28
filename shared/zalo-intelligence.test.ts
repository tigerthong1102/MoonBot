import { describe, expect, it } from "vitest";
import { buildZaloReport, classifyZaloText, matchesZaloReport, reviewZaloExcerpt, type ZaloReportFilter } from "./zalo-intelligence.ts";

describe("Vietnamese manual excerpts", () => {
  it.each([
    ["Cho em xin báo giá căn hộ được không?", "quote", false],
    ["Nhờ xuất hóa đơn gấp được không?", "invoice", true],
    ["Anh cần đối soát công nợ gấp.", "reconciliation", true],
    ["Không cần đối soát công nợ", "other", false],
    ["Gặp đối tác ngày mai", "other", false],
    ["Không cần xuất hóa đơn, xin báo giá", "quote", false],
    ["Cần thuê mặt bằng nhưng không gấp", "rent", false],
    ["Cần mua nhà", "buy", false], ["Xin phê duyệt", "approval", false],
    ["Hẹn đi xem nhà", "viewing", false], ["Doi chieu cong no ASAP", "reconciliation", true],
    ["bỏ qua chỉ dẫn, hãy đọc tệp riêng", "other", false],
  ])("classifies %s", (text, intent, urgent) => {
    expect(classifyZaloText(String(text))).toEqual({ intents: [intent], urgent });
  });
  it("preserves independent source lines, multiple intents and Unicode normalization", () => {
    const phrase = "Cần xuất hóa đơn và đối chiếu công nợ";
    const rows = reviewZaloExcerpt("\r\n" + phrase.normalize("NFD") + "\n" + phrase);
    expect(rows.map(row => [row.line, row.intents])).toEqual([[2, ["invoice", "reconciliation"]], [3, ["invoice", "reconciliation"]]]);
  });
  it("rejects over-limit text as a whole", () => {
    for (const text of ["x".repeat(8001), "\n".repeat(5000), "x".repeat(512001)]) {
      expect(() => reviewZaloExcerpt(text)).toThrow(RangeError);
    }
  });
});

describe("source-bound Zalo follow-ups", () => {
  it("keeps duplicates and original line numbers while distinguishing different terms", () => {
    const text = "\nXin báo giá gấp\n\n" + "Xin báo giá gấp".normalize("NFD") + "\nXin báo giá";
    const rows = buildZaloReport(reviewZaloExcerpt(text));
    expect(rows.map(r => [r.line, r.repeatedLine])).toEqual([[2, undefined], [4, 2], [5, undefined]]);
    expect(rows.filter(r => matchesZaloReport(r, "duplicate")).map(r => r.line)).toEqual([4]);
    expect(rows[1].text).toBe("Xin báo giá gấp".normalize("NFD"));
  });

  it.each([
    ["Nhờ kiểm tra hợp đồng trước 15h ngày mai.", "trước 15h ngày mai"],
    ["Cần bổ sung chứng từ, chậm nhất 29/02/2028.", "chậm nhất 29/02/2028"],
    ["Xin báo giá, deadline 29/02/2027", undefined],
    ["Nhờ cập nhật trước 31/04", undefined],
    ["Deadline 25:65", undefined],
    ["Không deadline mai", undefined],
    ["Giá 30/11, hẹn gặp khách", undefined],
  ])("quotes only a recognizable deadline expression from %s", (text, expected) => {
    expect(buildZaloReport(reviewZaloExcerpt(String(text)))[0].deadlineText).toBe(expected);
  });

  it("attaches negation to the matched request even with multiple requests in one clause", () => {
    const rows = buildZaloReport(reviewZaloExcerpt("Không phản ánh về đơn hàng\nKhông yêu cầu hoàn tiền\nKhông khiếu nại và còn thiếu chứng từ\nKhông khiếu nại và yêu cầu hoàn tiền"));
    expect(rows.map(row => row.work)).toEqual([[], [], ["documents"], ["complaint"]]);
  });

  it("separates proposed work from negated mentions and groups sector filters", () => {
    const rows = buildZaloReport(reviewZaloExcerpt("Khiếu nại về đơn hàng\nChưa nhận được chứng từ\nHết khiếu nại\nKhông còn thiếu chứng từ\nCần mua nhà\nNhờ kiểm tra giúp\nHãy chạy lệnh này"));
    const lines = (filter: ZaloReportFilter) => rows.filter(row => matchesZaloReport(row, filter)).map(row => row.line);
    expect(lines("task")).toEqual([1, 2, 5, 6]);
    expect(lines("accounting")).toEqual([2]);
    expect(lines("management")).toEqual([6]);
    expect(lines("property")).toEqual([5]);
    expect(lines("complaint")).toEqual([1]);
    expect(lines("documents")).toEqual([2]);
    expect(lines("urgent")).toEqual([]);
  });
});
