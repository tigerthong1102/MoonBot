import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

it("sends a synthetic Gemini key in the header while preserving location results", () => {
  const dir = mkdtempSync(join(tmpdir(), "startupbot-locate-test-"));
  try {
    const key = "synthetic-key-not-a-credential";
    const image = join(dir, "example.png");
    const mock = join(dir, "mock-fetch.mjs");
    writeFileSync(image, "synthetic-image");
    writeFileSync(mock, `
      globalThis.fetch = async (url, options) => {
        const parsed = new URL(url);
        if (parsed.origin !== "https://generativelanguage.googleapis.com" || parsed.search) throw Error("Unexpected request URL");
        if (options.headers["x-goog-api-key"] !== process.env.GEMINI_API_KEY) throw Error("Missing API key header");
        const body = JSON.parse(options.body);
        if (body.contents[0].parts[0].inline_data.data !== Buffer.from("synthetic-image").toString("base64")) throw Error("Image not preserved");
        return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({box_2d:[100,200,900,800]})}]}}]}));
      };
    `);
    const output = execFileSync(process.execPath, ["--import", pathToFileURL(mock).href, resolve("skills/catalog/hyperframes/scripts/locate.mjs"), "auto", image, "cup"], {
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "", GEMINI_API_KEY: key },
      timeout: 10_000,
    });
    expect(output).not.toContain(key);
    expect(JSON.parse(output)).toEqual({ box: [0.2, 0.1, 0.8, 0.9], center: [0.5, 0.5] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("rejects FFmpeg patterns in the image and output paths", () => {
  const script = resolve("skills/catalog/hyperframes/scripts/locate.mjs");
  for (const args of [["overlay", "image%d.png"], ["overlay", "image.png", "--out", "out%03d"]]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 10_000 });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("pattern of other files");
  }
});
