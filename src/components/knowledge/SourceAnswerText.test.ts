import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { sourceLink } from "../../../shared/source-evidence";
import { isSourceAnswer, SourceAnswerText } from "./SourceAnswerText";

it("renders external URLs, Markdown and local paths as text, and offers only the validated citation", () => {
  const target = sourceLink("a".repeat(64), 14, "ERP/Guide (1).pdf");
  const text = "Use https://example.test, /tmp/receipt.pdf and \\[portal\\]\\(https://example.test\\). [1](" + target + ")";
  const html = renderToStaticMarkup(createElement(SourceAnswerText, { text, threadId: "room" }));
  expect(html).toContain("https://example.test, /tmp/receipt.pdf and [portal](https://example.test)");
  expect(html).toContain('dir="auto"');
  expect(html).toContain("overflow-wrap:anywhere");
  expect(html).not.toMatch(/<a\b|<img\b/);
  expect(html.match(/<button\b/g)).toHaveLength(1);
  expect(html).toContain(">[1]</button>");
  expect(isSourceAnswer({ role: "bot", sendId: "source-00000000-0000-4000-8000-000000000000-0123456789abcdef-a" })).toBe(true);
});
