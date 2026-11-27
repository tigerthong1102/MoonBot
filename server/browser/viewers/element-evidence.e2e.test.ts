import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CdpPage } from "../cdp/page.ts";
import { FixtureServer } from "../cdp/testing/fixtures.ts";
import { CHROME, startChrome, type RunningChrome } from "../cdp/testing/real-chrome.ts";
import { hostTimeout } from "../../testing/host-timeout.ts";
import { elementEvidence } from "./element-evidence.ts";

describe.skipIf(!CHROME)("element evidence in Chrome", () => {
  let run: RunningChrome;
  let fx: FixtureServer;
  let page: CdpPage;
  beforeAll(async () => {
    fx = await FixtureServer.start();
    run = await startChrome("element-evidence");
    page = await run.browser.waitForPage();
    const url = fx.page("/element", `<style>*{margin:0}button,input{display:block;width:120px;height:40px}</style>
      <button id="save" onclick="this.remove()">Save</button><input value="private-value">
      <div contenteditable>private-value</div>`);
    await page.navigate(url + "?auth_token=never-include#secret");
  }, hostTimeout(120_000));
  afterAll(async () => { await run?.close(); await fx?.close(); });
  it("captures a bounded PNG and a selector without clicking or including the URL query", async () => {
    const result = await elementEvidence(page, 15, 16);
    expect(result?.text).toContain("button#save");
    expect(result?.text).toContain("Save");
    expect(result?.text).not.toMatch(/auth_token|private-value|#secret/);
    const png = Buffer.from(result!.image!, "base64");
    expect(png.toString("ascii", 1, 4)).toBe("PNG");
    expect(png.readUInt32BE(16)).toBeLessThanOrEqual(120);
    expect(png.readUInt32BE(20)).toBeLessThanOrEqual(40);
  });
  it("labels copies of the same element with each actual viewport", async () => {
    try {
      for (const width of [390, 1024]) {
        await page.emulateSize({ width, height: 800 });
        const result = await elementEvidence(page, 15, 16);
        expect(result?.text).toContain("Viewport: " + width + " × 800 CSS px");
        expect(result?.text).toContain("button#save");
      }
    } finally { await page.emulateSize(null); }
  });
  it("refuses editable controls and invalid coordinates", async () => {
    for (const y of [58, 86, -1, NaN]) expect(await elementEvidence(page, 15, y)).toBeNull();
  });
});
