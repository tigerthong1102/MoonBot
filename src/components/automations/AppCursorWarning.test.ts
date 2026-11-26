import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AppCursorWarning } from "./AppCursorWarning";

it.each(["unverified", "changed", "unavailable", "event_problem"] as const)("shows a visible alert for %s", issue => {
  const html = renderToStaticMarkup(createElement(AppCursorWarning, { issue }));
  expect(html).toContain('role="alert"');
  expect(html).toContain(`data-app-cursor-warning="${issue}"`);
  expect(html).toContain("text-danger");
});

it("does not show an alert when the cursor is safe", () => {
  expect(renderToStaticMarkup(createElement(AppCursorWarning, { issue: undefined }))).toBe("");
});
