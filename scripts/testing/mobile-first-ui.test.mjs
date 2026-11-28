// @vitest-environment happy-dom
import { mobileCatalog, renderMobilePage } from "../../apps/ai-pilot/mobile-catalog.mjs";
import html from "../../apps/ai-pilot/mobile.html?raw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

const saved = "970f6a6d-8f24-4331-8400-7d673278185a";
const el = id => document.getElementById(id);
const idle = () => vi.waitFor(() => expect(el("send").disabled).toBe(false));

beforeEach(() => {
  vi.resetModules();
  document.documentElement.lang = "en";
  const body = renderMobilePage(html, mobileCatalog("en")).split("<body>")[1].split('<script type="module"')[0];
  document.body.innerHTML = body;
  vi.stubGlobal("BroadcastChannel", undefined);
  // happy-dom lacks the browser's Option(text, value) constructor.
  vi.stubGlobal("Option", function Option(text, value) {
    const node = document.createElement("option");
    node.textContent = text;
    node.value = value;
    return node;
  });
});

it("keeps each chat draft in its tab, requires first-send consent and clears drafts on sign-out", async () => {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (path, init) => {
    calls.push({ path, body:init.body && JSON.parse(init.body) });
    if (path.endsWith("/threads")) return Response.json({ account:"fixture", threads:[{ id:saved, title:"Saved", provider:"managed" }] });
    if (path.endsWith("/history")) return Response.json({ turns:[], next:null });
    if (path.endsWith("/send")) return new Response('{"text":"Hi"}\n{"state":"complete"}\n');
    return Response.json({ ok:true });
  }));
  await import("../../apps/ai-pilot/mobile-ui.js");
  await vi.waitFor(() => expect(el("threads").value, el("status").textContent).toBe(saved));
  await idle();
  el("prompt").value = "unsent reply";
  el("new").click();
  await idle();
  el("prompt").value = "unsent new chat";
  el("new").click();
  await idle();
  expect(el("prompt").value).toBe("unsent new chat");
  el("tools").open = true;
  el("threads").value = saved;
  el("threads").dispatchEvent(new Event("change"));
  await idle();
  expect(el("prompt").value).toBe("unsent reply");
  el("new").click();
  await idle();
  expect(el("prompt").value).toBe("unsent new chat");
  expect(el("consent").checked).toBe(false);
  el("consent").checked = true;
  el("compose").dispatchEvent(new SubmitEvent("submit", { cancelable:true, submitter:el("send") }));
  await idle();
  expect(calls.filter(c => c.path.endsWith("/send")).map(c => c.body.save)).toEqual([true]);
  el("tools").open = true;
  el("logout").click();
  await idle();
  expect(el("login").hidden).toBe(false);
  expect(el("prompt").value).toBe("");
});

it("completes the provider callback once when the saved conversation history needs a retry", async () => {
  window.history.replaceState(null, "", "/mobile/callback?code=fixture-code&state=fixture-state");
  const complete = vi.fn(() => Response.json({ ok:true }));
  const historyPage = vi.fn()
    .mockResolvedValueOnce(Response.json({ error:{ code:"account_unavailable" } }, { status:503 }))
    .mockImplementation(() => Response.json({ turns:[{ prompt:"saved prompt", answer:"restored answer", state:"complete" }], next:null }));
  vi.stubGlobal("fetch", async (path, init) => {
    if (path === "/mobile/threads") return Response.json({ account:"fixture", threads:[{ id:saved, title:"Saved", provider:"managed" }] });
    if (path === "/mobile/history") return historyPage();
    if (path === "/mobile/provider/complete") return complete(JSON.parse(init.body));
    throw Error("Unexpected route " + path);
  });

  await import("../../apps/ai-pilot/mobile-ui.js");
  await vi.waitFor(() => expect(historyPage).toHaveBeenCalledOnce());
  await idle();
  expect(location.pathname + location.search).toBe("/mobile");
  expect(el("retry").hidden).toBe(false);
  el("retry").click();
  await idle();
  expect(el("transcript").textContent).toContain("restored answer");
  expect(complete).toHaveBeenCalledExactlyOnceWith({ account:"fixture", code:"fixture-code", state:"fixture-state" });
});
