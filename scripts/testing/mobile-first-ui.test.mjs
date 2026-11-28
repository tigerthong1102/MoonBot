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

it("restores a continuous page after another device adds more than a page of messages", async () => {
  const turn = n => ({id:crypto.randomUUID(), prompt:String(n), answer:"ok", state:"complete", created:n});
  const turns = Array.from({length:26}, (_,i)=>turn(i));
  const list = {account:"alice", threads:[{id:saved,title:"Synced",provider:"managed"}]};
  const cursor = n => ({created:n,id:turns[n].id});
  vi.stubGlobal("fetch", vi.fn(async (path, init) => {
    if (path === "/mobile/threads") return Response.json(list);
    if (path === "/mobile/sync") return Response.json({...list,revision:"new",turns:turns.slice(14),next:cursor(14)});
    const before = JSON.parse(init.body).before;
    const end = before?.created ?? 13, start = Math.max(0,end-12);
    return Response.json({turns:turns.slice(start,end),next:start ? cursor(start) : null});
  }));
  await import("../../apps/ai-pilot/mobile-ui.js");
  await idle();
  window.dispatchEvent(new Event("focus"));
  await vi.waitFor(()=>expect(el("transcript").querySelector("[data-turn]")?.dataset.turn).toBe(turns[14].id));
  el("older").click(); await idle();
  el("older").click(); await idle();
  expect([...el("transcript").querySelectorAll("article.mine")].map(node=>node.dataset.turn)).toEqual(turns.map(t=>t.id));
  expect(el("older").hidden).toBe(true);
});

it("keeps each chat draft in its tab, syncs sent messages automatically and clears drafts on sign-out", async () => {
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
  expect(el("consent")).toBeNull();
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

it("shows the receiving machine and retains both the phone draft and its receipt on retry", async () => {
  const sends=[];
  let threadReads=0;
  vi.stubGlobal("fetch", async (path,init) => {
    if (path.endsWith("/threads")) {
      threadReads++;
      if (threadReads>1) throw Error("unexpected chat refresh while picking a desktop");
      return Response.json({account:"owner",threads:[],desktopHandoff:true});
    }
    if (path.endsWith("/send")) {
      const body=JSON.parse(init.body);sends.push(body);
      const desktop=body.target ? {state:"received"} : {state:"choose",devices:[{id:saved,name:"Desktop",code:"abcd1234"}]};
      return Response.json({desktop});
    }
    throw Error(path);
  });
  await import("../../apps/ai-pilot/mobile-ui.js");
  await idle();el("skill").value="desktop";el("prompt").value="Review my file";
  const submit=()=>el("compose").dispatchEvent(new Event("submit",{cancelable:true}));
  submit();await idle();
  expect(el("handoffTargets").textContent).toContain("abcd1234");
  el("skill").value="chat";el("handoffTargets").firstChild.click();await idle();
  expect(sends).toHaveLength(1);
  el("skill").value="desktop";submit();await idle();
  el("compose").requestSubmit=submit;
  el("handoffTargets").firstChild.click();await idle();
  expect(sends.at(-1).target).toBe(saved);
  expect(el("prompt").value).toBe("Review my file");
  expect(el("status").textContent).toContain("Draft opened");
  submit();await idle();
  expect(new Set(sends.map(one=>one.id)).size).toBe(1);
  expect(threadReads).toBe(1);
});
