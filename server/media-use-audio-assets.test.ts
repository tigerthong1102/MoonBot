import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("ships the verified replacement audio bytes for every offline cue", () => {
  const directory = "skills/catalog/media-use/audio/assets/sfx";
  const manifest: Record<string, { file: string; duration: number }> = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  const provenance = readFileSync(join(directory, "REPLACEMENT-SOURCES.md"), "utf8");
  const hashes = new Map([...provenance.matchAll(/^\| ([\w-]+\.mp3) \| [^|]+ \| \d+ \| [\d.]+ \| ([a-f0-9]{64}) \|$/gm)].map((match) => [match[1], match[2]]));
  expect(Object.keys(manifest)).toHaveLength(19);
  expect(hashes.size).toBe(Object.keys(manifest).length);
  for (const entry of Object.values(manifest)) {
    expect(entry.duration).toBeGreaterThan(0);
    expect(createHash("sha256").update(readFileSync(join(directory, entry.file))).digest("hex")).toBe(hashes.get(entry.file));
  }
});
