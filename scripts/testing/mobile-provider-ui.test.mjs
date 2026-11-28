// @vitest-environment happy-dom
import { mobileCatalog, renderMobilePage } from "../../apps/ai-pilot/mobile-catalog.mjs";
import html from "../../apps/ai-pilot/mobile.html?raw";
import { afterEach, expect, it, vi } from "vitest";

const el = id => document.getElementById(id);
const idle = () => vi.waitFor(() => expect(el("send").disabled).toBe(false));

async function open(path, connected) {
  vi.resetModules();
  history.replaceState(null, "", path);
  document.documentElement.lang = "en";
  document.body.innerHTML = renderMobilePage(html, mobileCatalog("en")).split("<body>")[1].split('<script type="module"')[0];
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("Option", function Option(text, value) {
    const node = document.createElement("option");
    node.textContent = text;
    node.value = value;
    return node;
  });
  const requests = [];
  vi.stubGlobal("fetch", async (url, init) => {
    if (url === "/mobile/threads") return Response.json({ account:"fixture", threads:[], provider:{ enabled:true, connected } });
    if (url === "/mobile/provider/complete") return Response.json({ error:{ code:"provider_denied" } }, { status:400 });
    if (url === "/mobile/provider/disconnect") { connected = false; return Response.json({ ok:true }); }
    if (url === "/mobile/send") {
      requests.push(JSON.parse(init.body));
      return new Response('{"state":"complete"}\n');
    }
    throw Error("Unexpected route " + url);
  });
  await import("../../apps/ai-pilot/mobile-ui.js");
  await vi.waitFor(() => expect(el("chat").hidden).toBe(false));
  await idle();
  return requests;
}

afterEach(() => { vi.unstubAllGlobals(); history.replaceState(null, "", "/mobile"); });

it("can send from the same page after a provider denies its callback", async () => {
  const sends = await open("/mobile/callback?error=access_denied", false);
  el("prompt").value = "hello";
  el("compose").dispatchEvent(new Event("submit", { cancelable:true }));
  await idle();
  expect(sends).toHaveLength(1);
  expect(sends[0]).toMatchObject({ thread:expect.stringMatching(/^[a-f0-9-]{36}$/), provider:"managed" });
});

it("keeps the selected funding source when personal credit disconnects", async () => {
  await open("/mobile", true);
  el("provider").value = "openrouter";
  el("disconnectProvider").click();
  await idle();
  expect(el("provider").value).toBe("openrouter");
  expect(el("consent")).toBeNull();
  expect(el("billing").hidden).toBe(false);
});
