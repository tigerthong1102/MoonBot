import type { Page } from "./bench-desktop-page.ts";

/** Real, unsent input on the isolated benchmark page. Timing includes CDP and two animation frames. */
export async function measureComposerInput(page: Page) {
  const selector = 'textarea[aria-label^="Message"], textarea[placeholder^="Message"]';
  const field = 'document.querySelector(' + JSON.stringify(selector) + ')';
  if (!await page.evaluate('Boolean(' + field + ')')) throw new Error("The benchmark conversation has no visible composer");
  const before = await page.evaluate<string>(field + ".value");
  if (before) throw new Error("The benchmark requires a clean fixture draft");
  await page.evaluate(field + ".focus()");
  let expected = "";
  const samples = [];
  for (const char of "startupbot") {
    const started = performance.now();
    await page.send("Input.insertText", { text: char });
    await page.evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
    expected += char;
    if (await page.evaluate(field + ".value") !== expected) throw new Error("The streaming composer lost typed input");
    samples.push(Math.round((performance.now() - started) * 10) / 10);
  }
  await page.evaluate(field + ".select()");
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", windowsVirtualKeyCode: 8 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", windowsVirtualKeyCode: 8 });
  if (await page.evaluate(field + ".value") !== before) throw new Error("The benchmark draft was not restored");
  samples.sort((a, b) => a - b);
  return { samples: samples.length, medianMs: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.ceil(samples.length * 0.95) - 1] };
}
