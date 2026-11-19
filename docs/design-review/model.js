export const sectors = {
  general: {
    name: "Tổng quát",
    agent: "Minh",
    role: "Điều phối công việc",
    tools: "Tệp, ghi chú",
    prompt: "Tóm tắt biên bản họp và lập danh sách việc cần làm.",
    review: "Duyệt bản tóm tắt cuộc họp",
    running: "Tổng hợp ghi chú bàn giao",
    done: "Danh sách việc sau cuộc họp",
    file: "bien-ban-hop.md",
    output:
      "• Xác nhận người phụ trách từng đầu việc.\n• Hoàn thiện bản bàn giao.\n• Gửi lại bản nháp để nhóm rà soát.",
  },
  accounting: {
    name: "Kế toán",
    agent: "An",
    role: "Đối chiếu chứng từ",
    tools: "Đọc nguồn mẫu, xuất bản nháp",
    prompt: "Đối chiếu hóa đơn mẫu với bảng kê và lập báo cáo nháp.",
    review: "Rà soát chênh lệch hóa đơn",
    running: "Đối chiếu bảng kê đầu vào",
    done: "Báo cáo đối chiếu nháp",
    file: "doi-chieu-HDM01.csv",
    output:
      "Hóa đơn mẫu HD-M01\nHóa đơn 1.200.000 ₫ · Bảng kê 1.180.000 ₫\nChênh lệch 20.000 ₫. Cần kiểm tra lại dòng chi phí.\nKết quả nằm trong workspace mẫu.",
  },
  sales: {
    name: "Kinh doanh",
    agent: "Linh",
    role: "Soạn phản hồi khách hàng",
    tools: "Ghi chú, bản nháp",
    prompt: "Soạn phản hồi nháp cho yêu cầu báo giá trong hồ sơ mẫu.",
    review: "Duyệt phản hồi báo giá",
    running: "Tổng hợp yêu cầu báo giá",
    done: "Thư phản hồi khách hàng mẫu",
    file: "phan-hoi-bao-gia.md",
    output:
      "Chào anh chị,\nBên mình đã nhận yêu cầu báo giá. Anh chị cho biết thêm số lượng và ngày cần nhận để mình chuẩn bị phương án phù hợp nhé.\nBản nháp chưa gửi.",
  },
  marketing: {
    name: "Marketing",
    agent: "Vy",
    role: "Biên tập nội dung",
    tools: "Lịch nội dung, bản nháp",
    prompt: "Lập bản nháp bài giới thiệu sản phẩm từ brief mẫu.",
    review: "Duyệt bài giới thiệu sản phẩm",
    running: "Lập lịch nội dung tuần",
    done: "Bài giới thiệu phiên bản nháp",
    file: "bai-gioi-thieu.md",
    output:
      "Từ ý tưởng đến bản nháp đầu tiên\nTuần này, nhóm chia sẻ cách chuẩn bị một brief rõ ràng và cùng biên tập bản mẫu.\nBản nháp chưa đăng.",
  },
};
export const sections = {
  review: "Cần bạn duyệt",
  running: "Đang thực hiện",
  done: "Kết quả gần đây",
};
export const statuses = {
  ...sections,
  review: "Cần duyệt",
  running: "Đang chạy",
  done: "Hoàn thành",
  cancel: "Đã hủy",
  error: "Có lỗi",
};
export const defaultLayouts = {
  general: ["review", "running", "done"],
  accounting: ["review", "done", "running"],
  sales: ["running", "review", "done"],
  marketing: ["review", "running", "done"],
};
export function seed(sector) {
  const team = sectors[sector];
  return ["review", "running", "done"].map((status, i) => ({
    id: sector + "-" + (108 - i),
    thread: "chat-" + sector + "-" + i,
    title: team[status],
    agent: team.agent,
    state: status,
    time: ["10:18", "09:54", "09:36"][i],
    request: team.prompt,
    output: team.output,
    fixture: true,
  }));
}
export function load(key, fallback) {
  try {
    return (
      JSON.parse(localStorage.getItem("startupbot-review-v1/" + key)) ??
      fallback
    );
  } catch {
    return fallback;
  }
}
export function save(key, value) {
  try {
    localStorage.setItem("startupbot-review-v1/" + key, JSON.stringify(value));
  } catch {}
}
export function layoutFor(sector) {
  const defaults = defaultLayouts[sector].map((id) => ({
    id,
    visible: true,
    pinned: false,
  }));
  const data = load("layout/" + sector, defaults);
  if (!Array.isArray(data)) return defaults;
  const selected = [];
  for (const item of data)
    if (
      item &&
      Object.hasOwn(sections, item.id) &&
      !selected.some((w) => w.id === item.id)
    )
      selected.push({
        id: item.id,
        visible: item.visible !== false,
        pinned: item.pinned === true,
      });
  return selected.concat(
    defaults.filter((d) => !selected.some((w) => w.id === d.id)),
  );
}
