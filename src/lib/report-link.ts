export function readReportLink(params: URLSearchParams) {
  const match = params.get("report")?.match(/^([\w-]{1,200})\/([\w-]{1,200})$/);
  return match ? { threadId: match[1]!, messageId: match[2]! } : null;
}
