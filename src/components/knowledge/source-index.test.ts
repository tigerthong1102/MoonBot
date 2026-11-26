import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { findPassages, indexSources, splitPassages, type Index } from "./source-index";
import { parseSourceLink, sourceLink } from "./source-cache";

const empty: Index = { docs: new Map(), changes: [] };
const file = (path: string, text: string | Uint8Array<ArrayBuffer>) => ({ path, file: new File([text], path) });

describe("document sources", () => {
  it("preserves page, paragraph and offsets, and matches Vietnamese without accents", async () => {
    const text = "An toàn\n\n  Hồ sơ\f\n  Đối chiếu\n\nChứng từ\r\n\r\nTài liệu";
    const index = await indexSources([file("internal/misa.txt", text)], empty);
    const hit = findPassages(index, "doi chieu")[0]!;
    expect(hit.passage).toEqual({ page: 2, paragraph: 1, start: text.indexOf("Đối chiếu"), text: "Đối chiếu" });
    expect(splitPassages(text).at(-1)?.paragraph).toBe(3);
    const digest = index.docs.get(hit.path)!.digest;
    expect(parseSourceLink(`#startupbot-source-${digest}-${hit.passage.start}`)).toEqual({ digest, start: hit.passage.start });
    expect(parseSourceLink(sourceLink(digest, hit.passage.start, "MISA/File (final).txt"))).toEqual({ digest, start: hit.passage.start, path: "MISA/File (final).txt" });
    expect(parseSourceLink("#startupbot-source-../../a-0")).toBeNull();
    expect(findPassages(index, "nonexistent")).toEqual([]);
  });
  it("indexes plain HTTP files with the same digest as Web Crypto", async () => {
    const path = "policy.txt";
    const text = "Đối chiếu\r\n";
    const secure = await indexSources([file(path, text)], empty);
    vi.stubGlobal("crypto", {});
    try {
      const index = await indexSources([file(path, text)], empty);
      expect(index.docs.get(path)?.digest).toBe(createHash("sha256").update(text).digest("hex"));
      expect(index.docs.get(path)?.digest).toBe(secure.docs.get(path)?.digest);
      expect((await indexSources([file(path, text)], secure)).docs.get(path)).toBe(secure.docs.get(path));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("searches mixed-language documents on WebViews without Intl.Segmenter", async () => {
    const index = await indexSources([
      file("政策.txt", "这是公司的报销政策。"), file("ja.txt", "報告書を確認してください。"),
      file("en.txt", "Quarterly records"), file("vi.txt", "Đối chiếu chứng từ".normalize("NFD")),
      file("names.txt", "𠮷野"), file("kana.txt", "ガイドを読む"),
    ], empty);
    const original = Object.getOwnPropertyDescriptor(Intl, "Segmenter")!;
    Object.defineProperty(Intl, "Segmenter", { ...original, value: undefined });
    try {
      const searches = [["quarterly", "en.txt"], ["doi chieu", "vi.txt"], ["报销", "政策.txt"], ["報告書", "ja.txt"],
        ["𠮷", "names.txt"], ["ｶﾞｲﾄﾞ", "kana.txt"]] as const;
      for (const [question, path] of searches) {
        expect(findPassages(index, question)[0]?.path).toBe(path);
      }
      expect(findPassages(index, "quarter")).toEqual([]);
      expect(findPassages(index, "飞机")).toEqual([]);
    } finally {
      Object.defineProperty(Intl, "Segmenter", original);
    }
  });

  it("matches Chinese and Japanese words alongside English and Vietnamese terms", async () => {
    const index = await indexSources([file("zh.txt", "这是公司的报销政策。"), file("ja.txt", "報告書を確認してください。"),
      file("en.txt", "Quarterly records"), file("vi.txt", "Đối chiếu chứng từ".normalize("NFD"))], empty);
    for (const [question, path] of [["报销", "zh.txt"], ["報告書", "ja.txt"], ["quarterly", "en.txt"], ["doi chieu", "vi.txt"]] as const) {
      expect(findPassages(index, question)[0]?.path).toBe(path);
    }
    expect(findPassages(index, "quarter")).toEqual([]);
  });

  it("detects changes by content, evicts deleted or unreadable material and preserves identical snapshots", async () => {
    const old = await indexSources([file("a.md", "old"), file("b.txt", "removed"), file("c.txt", "broken"), file("d.txt", "same")], empty);
    const next = await indexSources([file("a.md", "new"), file("c.txt", new Uint8Array([255])), file("d.txt", "same"), file("e.txt", "added")], old);
    expect(next.docs.get("d.txt")).toBe(old.docs.get("d.txt"));
    expect(next.changes).toEqual([{ path: "a.md", state: "changed" }, { path: "c.txt", state: "error" }, { path: "e.txt", state: "added" }, { path: "b.txt", state: "removed" }]);
    expect(findPassages(next, "broken")).toEqual([]);
    expect(next.docs.has("b.txt")).toBe(false);
  });
});

it("preserves watched folder history on an unchanged refresh and evicts passages after folder access is revoked", async () => {
  const { scanSource } = await import("./source-sync");
  let revoked = false;
  const handle = { name: "policies", async *values() {
    if (revoked) throw new DOMException("permission revoked", "NotAllowedError");
    yield { kind: "file" as const, name: "policy.txt", getFile: async () => new File(["sensitive"], "policy.txt") };
  } };
  const source = { kind: "directory" as const, name: handle.name, handle };
  const first = await scanSource(source, empty);
  expect(first.changes).toEqual([{ path: "policies/policy.txt", state: "added", at: expect.any(Number) }]);
  const unchanged = await scanSource(source, first);
  expect(unchanged.changes).toEqual(first.changes);
  revoked = true;
  const denied = await scanSource(source, unchanged);
  expect(denied.changes).toEqual([...first.changes, { path: "policies", state: "error", issue: "folder", at: expect.any(Number) }]);
  expect(findPassages(denied, "sensitive")).toEqual([]);
});
