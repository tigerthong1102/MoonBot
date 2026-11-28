// @vitest-environment happy-dom
import html from "../../apps/ai-pilot/mobile.html?raw";
import { mobileCatalog, renderMobilePage } from "../../apps/ai-pilot/mobile-catalog.mjs";
import { afterEach, expect, it, vi } from "vitest";

const el = id => document.getElementById(id);

function install(page) {
  document.documentElement.lang = page.match(/<html lang="([^"]+)">/)[1];
  document.body.innerHTML = page.split("<body>")[1].split('<script type="module"')[0];
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.resetModules();
}

afterEach(() => vi.unstubAllGlobals());

it.each([
  ["network", () => { throw TypeError("Load failed"); }, "error"],
  ["non-success", () => Response.json({ error: { code:"account_unavailable" } }, { status:503 }), "unavailable"],
  ["invalid error JSON", () => new Response("bad JSON", { status:503 }), "error"],
  ["invalid success JSON", () => new Response("bad JSON"), "error"],
])("offers working session retry after %s with no catalog request", async (_, failure, message) => {
  install(renderMobilePage(html, mobileCatalog("vi")));
  const http = vi.fn().mockImplementationOnce(failure).mockResolvedValueOnce(Response.json({ error:{ code:"signed_out" } }, { status:401 }));
  vi.stubGlobal("fetch", http);
  await import("../../apps/ai-pilot/mobile-ui.js");
  await vi.waitFor(() => expect(el("retry").hidden).toBe(false));
  expect(el("retry").textContent).toBe(mobileCatalog("vi").messages.retry);
  expect(el("status").textContent).toBe(mobileCatalog("vi").messages[message]);
  el("retry").click();
  await vi.waitFor(() => expect(el("login").hidden).toBe(false));
  expect(http.mock.calls.map(([path]) => path)).toEqual(["/mobile/threads", "/mobile/threads"]);
});

it.each(["{invalid", "{}", '{"locale":"vi","messages":{}}'])("keeps a visible, localized page reload when catalog data is invalid", async bad => {
  install(renderMobilePage(html, mobileCatalog("vi")));
  el("mobileCatalog").textContent = bad;
  const http = vi.fn();
  vi.stubGlobal("fetch", http);
  await import("../../apps/ai-pilot/mobile-ui.js");
  expect(el("startupRetry").hidden).toBe(false);
  expect(el("startupRetry").textContent).toBe(mobileCatalog("vi").messages.retry);
  expect(el("startupRetry").getAttribute("href")).toBe("/mobile?lang=vi");
  expect(http).not.toHaveBeenCalled();
});

it("keeps catalog values in inert JSON regardless of tag or replacement syntax in translated text", () => {
  const catalog = mobileCatalog("en");
  catalog.messages.retry = "Retry & <again>";
  catalog.messages.example = "Text </ScRiPt> and $&";
  install(renderMobilePage(html, catalog));
  expect(document.body.querySelectorAll("script")).toHaveLength(1);
  expect(JSON.parse(el("mobileCatalog").textContent)).toEqual(catalog);
  expect(el("startupRetry").textContent).toBe(catalog.messages.retry);
});
