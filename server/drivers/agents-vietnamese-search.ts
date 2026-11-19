import { foldSearchText } from "../search-text.ts";

/** Search vocabulary only. The turn's catalog decides which of these tools exists and how it may run. */
const phrases: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["create_bot", ["tạo bot", "tạo trợ lý", "tạo nhân viên AI", "thêm bot", "tạo một bot"]],
  ["list_bots", ["danh sách bot", "liệt kê bot", "xem các bot"]],
  ["propose_bot_deletion", ["xóa bot", "xóa trợ lý"]],
  ["rename_thread", ["đổi tên hội thoại", "đổi tên cuộc trò chuyện", "đổi tên đoạn chat"]],
  ["list_threads", ["liệt kê hội thoại", "danh sách hội thoại", "xem các cuộc trò chuyện"]],
  ["session_search", ["tìm tin nhắn", "tìm trong lịch sử", "tìm lại hội thoại"]],
  ["trigger", ["tạo lịch", "đặt lịch", "tạm dừng lịch", "đổi lịch", "bật lại lịch"]],
  ["trigger_info", ["xem lịch tự động", "liệt kê lịch", "danh sách lịch"]],
  ["delete_trigger", ["xóa lịch tự động", "xóa lịch chạy"]],
  ["list_unread_notifications", ["xem thông báo", "thông báo chưa đọc"]],
  ["mark_notifications_read", ["đánh dấu đã đọc", "đánh dấu thông báo đã đọc"]],
  ["app_settings", ["xóa lịch sử", "xóa tin nhắn", "đổi giao diện", "đổi ngôn ngữ", "đổi màu bot", "đổi tên bot", "nhóm ở thanh bên", "nhóm bot ở thanh bên", "ghim bot", "sắp xếp bot"]],
];

function words(text: string): string {
  return foldSearchText(text)
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const vocabulary = phrases.flatMap(([name, synonyms]) => synonyms.map(phrase => ({ name, phrase: words(phrase) })))
  .sort((a, b) => b.phrase.length - a.phrase.length);

function vietnameseToolHints(query: string): string[] {
  const text = ` ${words(query)} `;
  return [...new Set(vocabulary.filter(entry => text.includes(` ${entry.phrase} `)).map(entry => entry.name))];
}

/** Preserve lexical search for other actions in a bilingual request. */
export function vietnameseToolQuery(query: string): { hints: string[]; remaining: string } {
  const hints = vietnameseToolHints(query);
  if (!hints.length) return { hints, remaining: query };
  const clauses = foldSearchText(query).split(/[.,;:!?，。；：！？、\n]+|\s+(?:va sau do|sau do|and then|and|then|va|roi)\s+/u);
  const remaining = clauses.filter(clause => !vietnameseToolHints(clause).length).join(" ").trim();
  return { hints, remaining };
}
