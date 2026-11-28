const polite = /^(?:(?:hãy|vui lòng|làm ơn|please|can you|could you)\s+)+/iu;
const startApp =
  /^(?:mở|chạy|khởi động|open|launch|start|run)\s+(?:(?:phần mềm|ứng dụng|ứng dụng kế toán|microsoft|the)\s+)*(?:misa|excel|quickbooks)(?=$|[\s.,!?:])/iu;
const localAction =
  /^(?:mở|chạy|cập nhật|chỉnh sửa|sửa|lưu|đối chiếu|nhập|xuất|ghi|xóa|kiểm tra|open|run|edit|update|save|reconcile|enter|import|export|delete|check)\s/iu;
const localTarget =
  /(?:\b(?:misa|quickbooks)\b|(?:trên|trong|vào|từ) (?:phần mềm )?(?:misa|excel)|(?:in|into|from|using) (?:microsoft )?excel\b|(?:trên|từ) (?:máy tính|desktop|ổ đĩa)\b|(?:on|from) (?:my|the) (?:computer|desktop|local drive)\b)/iu;
export function needsDesktop(prompt, runtime) {
  if (runtime === "desktop") return true;
  const text = prompt.trim().normalize("NFC").replace(polite, "");
  return startApp.test(text) || (localAction.test(text) && localTarget.test(text));
}
