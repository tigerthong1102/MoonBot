// @vitest-environment happy-dom
import { mobileCatalog } from "../../apps/ai-pilot/mobile-catalog.mjs";
import html from "../../apps/ai-pilot/mobile.html?raw";
import { afterEach, expect, it, vi } from "vitest";

const el = id => document.getElementById(id);
const idle = () => vi.waitFor(() => expect(el("send").disabled).toBe(false));

async function open(path, connected) {
  vi.resetModules();
  history.replaceState(null, "", path);
  document.body.innerHTML = html.split("<body>")[1].split("<script")[0];
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("Option", function Option(text, value) {
    const node = document.createElement("option");
    node.textContent = text;
    node.value = value;
    return node;
  });
  const requests = [];
  vi.stubGlobal("fetch", async (url, init) => {
    if (url.startsWith("/mobile/messages?")) return Response.json(mobileCatalog("en"));
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
  el("consent").checked = true;
  el("prompt").value = "hello";
  el("compose").dispatchEvent(new Event("submit", { cancelable:true }));
  await idle();
  expect(sends).toHaveLength(1);
  expect(sends[0]).toMatchObject({ thread:expect.stringMatching(/^[a-f0-9-]{36}$/), provider:"managed" });
});

it("requires fresh consent when disconnecting personal credit before the first send", async () => {
  await open("/mobile", true);
  el("provider").value = "openrouter";
  el("consent").checked = true;
  el("disconnectProvider").click();
  await idle();
  expect(el("provider").value).toBe("managed");
  expect(el("consent").checked).toBe(false);
  expect(el("billing").hidden).toBe(true);
});
