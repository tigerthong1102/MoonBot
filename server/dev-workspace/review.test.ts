import { expect, it } from "vitest";
import { reviewLines } from "./review.ts";
import { renderReview } from "./review-page.ts";
it("anchors removal and addition on opposite revisions and escapes code in offline reviews", () => {
  const lines = reviewLines("diff --git a/a b/a\n@@ -7,2 +11,2 @@\n-old\n+<script>bad()</script>\n same\n\\ No newline at end of file\n");
  expect(lines.map(({ side, line }) => [side, line])).toEqual([["LEFT", 7], ["RIGHT", 11], ["RIGHT", 12]]);
  const result = renderReview({ base: "a".repeat(40), head: "b".repeat(40), files: [{ path: "x&y", lines, truncated: false }] }, null);
  expect(result).toContain("x&amp;y");
  expect(result).toContain("&lt;script&gt;bad()&lt;/script&gt;");
  expect(result).not.toContain("<script>bad()");
});
