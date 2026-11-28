// @vitest-environment happy-dom
import html from "../../apps/ai-pilot/mobile.html?raw";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("keeps each chat draft in its tab, requires first-send consent and clears drafts on sign-out", async () => {
  const saved = "970f6a6d-8f24-4331-8400-7d673278185a";
  const body = html.slice(html.indexOf("<body>") + "<body>".length, html.indexOf("<script type="));
  document.body.innerHTML = body;
  const el = id => document.getElementById(id);
  const calls = [];
  vi.stubGlobal("BroadcastChannel", undefined);
  // happy-dom lacks the browser's Option(text, value) constructor.
  vi.stubGlobal("Option", function Option(text, value) {
    const node = document.createElement("option");
    node.textContent = text;
    node.value = value;
    return node;
  });
  vi.stubGlobal("fetch", vi.fn(async (path, init) => {
    calls.push({ path, body:init.body && JSON.parse(init.body) });
    if (path.endsWith("/threads")) return Response.json({ account:"fixture", threads:[{ id:saved, title:"Saved", provider:"managed" }] });
    if (path.endsWith("/history")) return Response.json({ turns:[], next:null });
    if (path.endsWith("/send")) return new Response('{"text":"Hi"}\n{"state":"complete"}\n');
    return Response.json({ ok:true });
  }));
  await import("../../apps/ai-pilot/mobile-ui.js");
  const idle = () => vi.waitFor(() => expect(el("send").disabled).toBe(false));
  await vi.waitFor(() => expect(el("threads").value, el("status").textContent).toBe(saved));
  await idle();
  el("prompt").value = "unsent reply";
  el("new").click();
  await idle();
  el("prompt").value = "unsent new chat";
  el("new").click();
  await idle();
  expect(el("prompt").value).toBe("unsent new chat");
  el("openMenu").click();
  el("threads").value = saved;
  el("threads").dispatchEvent(new Event("change"));
  await idle();
  expect(el("prompt").value).toBe("unsent reply");
  el("new").click();
  await idle();
  expect(el("prompt").value).toBe("unsent new chat");
  el("compose").dispatchEvent(new Event("submit", { cancelable:true }));
  expect(calls.filter(c => c.path.endsWith("/send"))).toHaveLength(0);
  el("compose").dispatchEvent(new SubmitEvent("submit", { cancelable:true, submitter:el("send") }));
  await idle();
  expect(calls.filter(c => c.path.endsWith("/send")).map(c => c.body.save)).toEqual([true]);
  el("openMenu").click();
  el("logout").click();
  await idle();
  expect(el("login").hidden).toBe(false);
  expect(el("prompt").value).toBe("");
});
