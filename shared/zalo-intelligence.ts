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
