import { buffer } from "node:stream/consumers";

const bytes = await buffer(process.stdin);
try {
  const valid = bytes.length <= 4 * 1024 * 1024 && (process.argv[2] === "xlsx"
    ? (await import("./reconciliation-workbook.ts")).passiveWorkbook(bytes)
    : process.argv[2] === "pdf" && await (await import("./reconciliation-pdf.ts")).passivePdf(bytes));
  process.exitCode = valid ? 0 : 1;
} catch {
  process.exitCode = 1;
}
