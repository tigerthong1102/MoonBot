export const ZALO_RECIPES = ["zalo-bat-dong-san", "zalo-ke-toan", "zalo-quan-ly"] as const;
export type ZaloRecipe = typeof ZALO_RECIPES[number];
export interface ZaloSourceLine {
  source: string;
  line: number;
}
export const ZALO_IMPORT_LIMIT = 512_000;
export const ZALO_LINE_LIMIT = 5_000;
export const ZALO_INTENTS = ["invoice", "reconciliation", "viewing", "buy", "rent", "approval", "quote", "other"] as const;
export type ZaloIntent = typeof ZALO_INTENTS[number];

const signals: ReadonlyArray<[Exclude<ZaloIntent, "other">, RegExp]> = [
  ["invoice", /\b(?:xuat|gui|can|xin|lay) (?:giup (?:anh|chi|em|minh) )?(?:hoa don|hd vat)\b/],
  ["reconciliation", /\b(?:doi chieu|doi soat|xac nhan) (?:cong no|so du)\b/],
  ["viewing", /\b(?:hen|lich|muon|can|dang ky|di) (?:di )?xem (?:nha|can ho|dat)\b/],
  ["buy", /\b(?:can|muon|tim) mua (?:nha|can ho|dat|chung cu)\b/],
  ["rent", /\b(?:can|muon|tim) thue (?:nha|can ho|mat bang|van phong|phong)\b/],
  ["approval", /\b(?:cho|can|xin|nho|vui long) (?:phe )?duyet\b/],
  ["quote", /\b(?:xin|can|gui|cho|lay) (?:minh |em |anh |chi )?(?:bao gia|bang gia)\b/],
];

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replaceAll("đ", "d").replace(/\s+/gu, " ").trim();
}

export function classifyZaloText(text: string) {
  const clauses = text.normalize("NFC").toLowerCase().replaceAll("gặp", "meet").split(/[,;.!?\n]|\bnhưng\b/u).map(fold);
  const negated = /\b(?:khong|ko|k|chua|dung|khoi|huy|da) (?:can |phai |muon |con |xin )?$/;
  const activeMatch = (clause: string, pattern: RegExp) => {
    const match = pattern.exec(clause);
    return match !== null && !negated.test(clause.slice(0, match.index));
  };
  const intents = signals.filter(([, pattern]) => clauses.some(clause => activeMatch(clause, pattern))).map(([intent]) => intent);
  const urgent = clauses.some(clause => activeMatch(clause, /\b(?:gap(?! (?:mat|nhau|anh|chi|em|khach|go|truc tiep|doi tac)\b)|khan cap|asap)\b/));
  return { intents: intents.length ? intents : ["other" as const], urgent };
}

export interface ZaloExcerpt {
  line: number;
  text: string;
  intents: ZaloIntent[];
  urgent: boolean;
}

/** Line numbers refer to the pasted excerpt. Names, timestamps and platform IDs are unknown. */
export function reviewZaloExcerpt(input: string): ZaloExcerpt[] {
  if (input.length > ZALO_IMPORT_LIMIT) throw new RangeError("excerpt_size");
  const lines = input.split(/\r\n|\n|\r/);
  if (lines.length > ZALO_LINE_LIMIT || lines.some(line => line.length > 8_000)) throw new RangeError("excerpt_size");
  return lines.flatMap((line, index) => {
    const text = line.trim();
    return text ? [{ line: index + 1, text, ...classifyZaloText(text) }] : [];
  });
}

export const ZALO_REPORT_FILTERS = ["all", "task", "urgent", "deadline", "complaint", "documents", "duplicate", "property", "accounting", "management"] as const;
export type ZaloReportFilter = typeof ZALO_REPORT_FILTERS[number];
export type ZaloWorkItem = "invoice" | "reconciliation" | "viewing" | "buy" | "rent" | "approval" | "quote" | "complaint" | "documents" | "requested";
export interface ZaloReportRow extends ZaloExcerpt {
  work: ZaloWorkItem[];
  deadlineText?: string;
  repeatedLine?: number;
}

const timeWord = /(?:trước|truoc|chậm nhất|cham nhat|hạn chót|han chot|đến hạn|den han|deadline|hạn gửi|han gui)\s*[:–-]?\s*(?:(?:ngày|ngay)\s+)?(?:(?:[01]?\d|2[0-3])(?:[hg](?:[0-5]\d)?|:[0-5]\d)(?:\s+(?:(?:ngày|ngay)\s+)?(?:hôm nay|hom nay|mai|nay|\d{1,2}\/\d{1,2}(?:\/\d{4})?))?|\d{1,2}\/\d{1,2}(?:\/\d{4})?|(?:sáng|sang|chiều|chieu|tối|toi)\s+mai|mai|hôm nay|hom nay|cuối tuần|cuoi tuan)(?![\p{L}\p{N}/:])/giu;

function quotedDeadline(text: string): string | undefined {
  for (const match of text.matchAll(timeWord)) {
    const prefix = text.slice(0, match.index);
    const before = fold(prefix);
    if (/[\p{L}\p{N}]$/u.test(prefix) ||
        /\b(?:khong|ko|k|huy|bo|doi|qua)\s*$/.test(before)) continue;
    const date = /(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/.exec(match[0]);
    if (date) {
      const day = Number(date[1]), month = Number(date[2]), year = Number(date[3]);
      const last = new Date(Date.UTC(year || 2000, month, 0)).getUTCDate();
      if (month < 1 || month > 12 || day < 1 || day > last) continue;
    }
    return match[0];
  }
}

export function buildZaloReport(rows: ZaloExcerpt[]): ZaloReportRow[] {
  const firstLine = new Map<string, number>();
  return rows.map(row => {
    const sourceText = row.text.normalize("NFC");
    const clauses = fold(sourceText).split(/[,;.!?]|\bnhung\b/);
    const work: ZaloWorkItem[] = row.intents.filter(intent => intent !== "other");
    for (const clause of clauses) {
      if (/\b(?:khong|ko|k|het|huy|da xu ly)\s+(?:con\s+)?(?:khieu nai|thieu|can bo sung)\b/.test(clause)) continue;
      if (/\b(?:khieu nai|phan anh ve|yeu cau hoan tien)\b/.test(clause) && !work.includes("complaint")) work.push("complaint");
      if (/\b(?:thieu|chua (?:co|nhan duoc)|can bo sung) (?:ban |bo )?(?:chung tu|hoa don|bien ban|phieu thu|phieu chi|hop dong)\b/.test(clause) && !work.includes("documents")) work.push("documents");
      if (!work.length && /\b(?:nho|vui long|lam on) (?:anh |chi |em |ban )?(?:gui|kiem tra|cap nhat|chuan bi|xac minh)\b/.test(clause) &&
          !/\b(?:khong|ko|k|huy)\s+/.test(clause)) work.push("requested");
    }
    const repeatedLine = firstLine.get(sourceText);
    if (repeatedLine === undefined) firstLine.set(sourceText, row.line);
    return { ...row, work, repeatedLine, deadlineText: quotedDeadline(sourceText) };
  });
}

export function matchesZaloReport(row: ZaloReportRow, filter: ZaloReportFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "task": return row.work.length > 0;
    case "urgent": return row.urgent;
    case "deadline": return !!row.deadlineText;
    case "duplicate": return row.repeatedLine !== undefined;
    case "complaint": case "documents": return row.work.includes(filter);
    case "property": return row.work.some(item => item === "buy" || item === "rent" || item === "viewing");
    case "accounting": return row.work.some(item => item === "invoice" || item === "reconciliation" || item === "documents");
    case "management": return row.work.some(item => item === "approval" || item === "requested");
  }
}
