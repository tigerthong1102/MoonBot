/*! AgenticOS, Copyright 2026 Vstorm. Apache-2.0.
 * Modified for StartupBot: TypeScript port of cited_page using the indexed path and PDF parser.
 * See public/licenses/agenticos-citation.txt for attribution and license. */
import { t } from "@/lib/i18n";
import type { Passage } from "./source-index";

export function citedPage(path: string, page: unknown): number | null {
  if (!/\.pdf$/i.test(path)) return null;
  return typeof page === "number" && Number.isSafeInteger(page) && page >= 1 ? page : null;
}

export function citationLocation(path: string, passage: Pick<Passage, "page" | "paragraph">): string {
  const page = citedPage(path, passage.page);
  const location = { file: path, paragraph: passage.paragraph };
  return page === null ? t("knowledge.paragraphLocation", location) : t("knowledge.location", { ...location, page });
}
