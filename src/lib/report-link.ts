export function readReportLink(params: URLSearchParams) {
  const match = params.get("report")?.match(/^([\w-]{1,200})\/([\w-]{1,200})$/);
  return match ? { threadId: match[1]!, messageId: match[2]! } : null;
}

export function shareableReportOrigin(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/\.$/, "");
    if (!/^https?:$/.test(url.protocol) || url.username || url.password ||
        /^(?:127\.|0\.0\.0\.0$|\[::(?:1)?\]$)/i.test(host) || /(?:^|\.)localhost$/i.test(host)) return "";
    return url.origin;
  } catch { return ""; }
}
