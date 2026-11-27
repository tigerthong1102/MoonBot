import type { CdpPage } from "../cdp/page.ts";
import { valueInWorld } from "../cdp/evaluate.ts";
import { SELECTOR_HELPERS } from "./element-selector.ts";

interface Pick {
  text: string;
  clip: { x: number; y: number; width: number; height: number; scale: number } | null;
}

export interface ElementEvidence {
  text: string;
  image: string | null;
}

// Inspect in the isolated world. Never serialize form values or arbitrary attributes.
// Screenshots are limited to small, unobstructed static leaves with no embedded controls.
export const inspectAt = (x: number, y: number) => `(() => {
  ${SELECTOR_HELPERS}
  const el = document.elementFromPoint(${Number(x)}, ${Number(y)});
  if (!el || !['http:', 'https:'].includes(location.protocol)) return null;
  const sensitive = 'input, textarea, select, iframe, frame, canvas, video, [contenteditable], [autocomplete], [role="textbox"]';
  if (el.closest(sensitive) || el.isContentEditable || el.shadowRoot) return null;
  const tag = el.localName;
  const role = el.getAttribute('role') || ({button:'button', a:'link', img:'img', h1:'heading', h2:'heading'})[tag] || '';
  const label = el.getAttribute('aria-label') || (el.childElementCount === 0 ? el.textContent : '') || '';
  const name = containsSecret(label) ? '' : label.trim().slice(0, 120);
  const css = getComputedStyle(el);
  const selector = buildSelector(el);
  const text = [location.origin, '<' + tag + '>', role.slice(0, 40), name, selector,
    'display: ' + css.display + ', color: ' + css.color].filter(Boolean).join('\\n');
  const rect = el.getBoundingClientRect();
  const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
  const w = Math.min(innerWidth, rect.right) - left, h = Math.min(innerHeight, rect.bottom) - top;
  let clip = null;
  if (['a','button','span','p','label','h1','h2','h3'].includes(tag) && !el.childElementCount &&
      !containsSecret(label) && w >= 2 && h >= 2 && w <= 768 && h <= 192) {
    const fields = document.querySelectorAll(sensitive);
    if (fields.length <= 500 && !Array.from(fields).some(field => {
      const r = field.getBoundingClientRect();
      return r.right > left && r.left < left + w && r.bottom > top && r.top < top + h;
    })) clip = { x: scrollX + left, y: scrollY + top, width: w, height: h, scale: Math.min(1, 1/devicePixelRatio) };
  }
  return {text, clip};
})()`;

export async function elementEvidence(page: CdpPage, x: number, y: number): Promise<ElementEvidence | null> {
  if (![x, y].every(n => Number.isFinite(n) && n >= 0)) return null;
  const expression = inspectAt(x, y);
  const read = () => valueInWorld<Pick | null>(page.frames, page.frames.mainFrameId, expression);
  const before = await read();
  if (!before) return null;
  if (!before.clip) return { text: before.text, image: null };
  const shot = await page.session.send<{ data: string }>("Page.captureScreenshot", {
    format: "png", fromSurface: true, captureBeyondViewport: false, clip: before.clip,
  }).catch(() => null);
  const after = await read();
  if (JSON.stringify(before) !== JSON.stringify(after)) return null;
  return { text: before.text, image: shot && shot.data.length <= 512_000 ? shot.data : null };
}
