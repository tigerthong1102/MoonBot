import { expect, it } from "vitest";
import { parseReviewNotes } from "./ImportReviewNotes";
it("imports the exported revision, side and line, including CRLF", () => {
  const body = "Review " + "a".repeat(40) + "\nBase " + "b".repeat(40) + "\n\nsrc/file.ts · RIGHT · 2\nAdd Vietnamese copy.\n";
  expect(parseReviewNotes(body.replaceAll("\n", "\r\n"))).toBe(body.trim());
  expect(() => parseReviewNotes(body.replace("RIGHT", "UNKNOWN"))).toThrow();
  expect(() => parseReviewNotes("Meeting notes")).toThrow();
});
