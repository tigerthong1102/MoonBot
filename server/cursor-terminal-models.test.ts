import { expect, it } from "vitest";
import { parseCursorModels } from "./cursor-terminal-models.ts";
it("reads the local Cursor model list once per ID and preserves the declared default", () => {
  expect(parseCursorModels("Available models:\r\nsmall - Small (current, default)\nlarge\nsmall - Other\n")).toEqual([
    { id: "small", label: "Small", isDefault: true }, { id: "large", label: "large" },
  ]);
});
