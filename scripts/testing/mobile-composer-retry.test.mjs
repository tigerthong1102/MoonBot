// @vitest-environment happy-dom
import { mobileCatalog, renderMobilePage } from "../../apps/ai-pilot/mobile-catalog.mjs";
import html from "../../apps/ai-pilot/mobile.html?raw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const el = id => document.getElementById(id);

let send, history;

beforeEach(async () => {
  vi.resetModules();
  document.documentElement.lang = "en";
  document.body.innerHTML = renderMobilePage(html, mobileCatalog("en")).split("<body>")[1].split('<script type="module"')[0];
  vi.stubGlobal("Option", function Option(text, value) {
    const option = document.createElement("option");
    option.textContent = text;
    option.value = value;
    return option;
  });
  send = vi.fn();
  history = vi.fn();
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("fetch", async (path, init) => {
    if (path === "/mobile/threads") return Response.json({ account:"test", threads:[] });
    if (path === "/mobile/history") return history();
    if (path === "/mobile/send") return send(JSON.parse(init.body));
    throw Error("Unexpected route " + path);
  });
  await import("../../apps/ai-pilot/mobile-ui.js");
  await vi.waitFor(() => expect(el("chat").hidden, el("status").textContent).toBe(false));
  el("consent").checked = true;
  el("prompt").value = "original";
});

afterEach(() => vi.unstubAllGlobals());

function submit() {
  el("compose").dispatchEvent(new Event("submit", { cancelable:true }));
}
const idle = () => vi.waitFor(() => expect(el("send").disabled).toBe(false));
function success() {
  return new Response('{"text":"hello"}\n{"state":"complete"}\n', { headers:{ "content-type":"application/x-ndjson" } });
}

it("keeps an edit made before stream headers arrive", async () => {
  const headers = Promise.withResolvers();
  send.mockReturnValue(headers.promise);
  submit();
  el("prompt").value = "original ";
  headers.resolve(success());
  await idle();
  expect(el("prompt").value).toBe("original ");
  expect(el("transcript").textContent).toContain("hello");
});

it.each([["next question", "next question"], ["original", ""]])("reads a duplicate back and preserves only newer draft text (%s)", async (draft, expected) => {
  const readback = Promise.withResolvers();
  const headers = Promise.withResolvers();
  send.mockRejectedValueOnce(Error("network")).mockReturnValueOnce(headers.promise);
  history.mockReturnValue(readback.promise);
  submit();
  await idle();
  submit();
  el("prompt").value = draft;
  el("skill").value = "translate";
  headers.resolve(Response.json({ error:{ code:"request_exists" } }, { status:409 }));
  await vi.waitFor(() => expect(history).toHaveBeenCalledOnce());
  readback.resolve(Response.json({ turns:[{ prompt:"original", answer:"stored reply", state:"complete" }] }));
  await idle();
  expect(send.mock.calls[1][0].id).toBe(send.mock.calls[0][0].id);
  expect(el("prompt").value).toBe(expected);
  expect(el("skill").value).toBe("translate");
  expect(el("transcript").textContent).toContain("stored reply");
});

it("allocates a fresh ID when the retry uses a different skill", async () => {
  send.mockRejectedValueOnce(Error("network")).mockResolvedValueOnce(success());
  submit();
  await idle();
  el("skill").value = "write";
  submit();
  await idle();
  expect(send.mock.calls[1][0].id).not.toBe(send.mock.calls[0][0].id);
  expect(el("prompt").value).toBe("");
});

it.each([true, false])("copies a mobile answer through the legacy fallback when browser access is denied (%s)", async copied => {
  send.mockResolvedValueOnce(success());
  submit();
  await idle();
  const legacy = vi.fn(() => copied);
  vi.stubGlobal("navigator", { get clipboard() { throw new Error("denied"); } });
  Object.defineProperty(document, "execCommand", { configurable:true, value:legacy });
  try {
    await el("transcript").querySelector("button").onclick();
    expect(legacy).toHaveBeenCalledWith("copy");
    expect(el("status").textContent.length > 0).toBe(!copied);
    expect(document.querySelector("textarea[readonly]")).toBeNull();
  } finally {
    delete document.execCommand;
  }
});
