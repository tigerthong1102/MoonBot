/*! AgenticOS, Copyright 2026 Vstorm. Apache-2.0.
 * Modified for StartupBot: TypeScript cases adapted from backend/tests/test_rag_citation.py.
 * See public/licenses/agenticos-citation.txt for attribution and license. */
import { describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { citationLocation, citedPage } from "./citation";

describe("source citation locations", () => {
  it("keeps a real PDF page from the indexed filename regardless of case", () => {
    expect(citedPage("policies/policy.pdf", 7)).toBe(7);
    expect(citedPage("policies/Report.PDF", 2)).toBe(2);
  });

  it.each(["capabilities.pl.md", "policy.markdown", "manual.txt", "ledger.csv", "ledger.tsv", "deck.pdf.txt", "unknown"])(
    "omits structural page 1 for %s, including previously indexed files", path => {
      expect(citedPage(path, 1)).toBeNull();
    });

  it.each([0, null, "3", true, -1, 1.5])("omits an invalid PDF page (%s)", page => {
    expect(citedPage("document.pdf", page)).toBeNull();
  });

  it("preserves paragraph locators with and without a page", () => {
    setLocale("en");
    const passage = { page: 2, paragraph: 3 };
    expect(citationLocation("report.pdf", passage)).toBe("report.pdf · page 2, paragraph 3");
    expect(citationLocation("policy.md", passage)).toBe("policy.md · paragraph 3");
  });
});
