// @vitest-environment happy-dom
import { mobileCatalog, renderMobilePage } from "../../apps/ai-pilot/mobile-catalog.mjs";
import html from "../../apps/ai-pilot/mobile.html?raw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const el = id => document.getElementById(id);

let send, history, extraPicker;

beforeEach(async () => {
  vi.resetModules();
  document.documentElement.lang = "en";
  document.body.innerHTML = renderMobilePage(html, mobileCatalog("en")).split("<body>")[1].split('<script type="module"')[0];
  el("compose").insertAdjacentHTML("beforeend", '<label for="extraPicker">Provider</label><select id="extraPicker" name="extraPicker"><option value="managed">Managed</option><option value="own" selected>Personal</option></select>');
  extraPicker = el("extraPicker");
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
    if (path === "/mobile/logout") return Response.json({});
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
  expect(el("announcement").textContent).not.toContain("stored reply");
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

it("boots every picker with the shared Select, native labels, options and keyboard focus", async () => {
  const fields = ["threads", "skill", "extraPicker"].map(el);
  expect(el("extraPicker")).toBe(extraPicker);
  expect(extraPicker.value).toBe("own");
  for (const field of fields) {
    expect(field.tagName).toBe("SELECT");
    expect(field.dataset.look).toBe("select");
    expect(field.closest("[data-inbox-select]").querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(document.querySelector('label[for="' + field.id + '"]').textContent).toBeTruthy();
    field.focus();
    expect(document.activeElement).toBe(field);
  }
  const { installInboxSelects } = await import("../../apps/ai-pilot/inbox-select.js");
  installInboxSelects(document.querySelectorAll("select"));
  expect(document.querySelectorAll("[data-inbox-select]")).toHaveLength(document.querySelectorAll("select").length);
  expect(el("skill").querySelector('option[value="write"]').textContent).toBeTruthy();
  expect([...document.querySelectorAll("button")].every(button => button.classList.contains("ui-button"))).toBe(true);
});

function startReply() {
  let stream;
  send.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { stream = controller; } })));
  submit();
  return {
    frame(value) { stream.enqueue(new TextEncoder().encode(JSON.stringify(value) + "\n")); },
    close() { stream.close(); },
  };
}

it.each(["complete", "limited"])("announces a %s reply once, including identical successive replies", async state => {
  const live = el("announcement");
  const notice = state === "limited" ? mobileCatalog("en").messages.limited : "";
  const spoken = ["hello world", notice].filter(Boolean).join("\n");
  const updates = [];
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) updates.push(node.textContent);
  });
  observer.observe(live, { childList:true });
  try {
    expect(live.getAttribute("role")).toBe("status");
    expect(live.getAttribute("aria-atomic")).toBe("true");
    expect(el("transcript").closest('[aria-live], [role="log"], [role="status"]')).toBeNull();
    for (let i = 0; i < 2; i++) {
      el("prompt").value = "again";
      el("send").focus();
      const reply = startReply();
      expect(document.activeElement).toBe(el("stop"));
      reply.frame({ text:"hello " });
      await vi.waitFor(() => {
        expect(el("transcript").children).toHaveLength(2 * (i + 1));
        expect(el("transcript").lastElementChild.textContent).toContain("hello");
      });
      expect(live.textContent).toBe("");
      reply.frame({ text:"**world**" });
      reply.frame({ state });
      reply.close();
      await idle();
      expect(live.textContent).toBe(spoken);
      expect(el("status").textContent).toBe(notice);
      expect(document.activeElement).toBe(el("prompt"));
    }
    expect(updates.filter(text => text.includes("hello"))).toEqual([spoken, spoken]);
    el("logout").click();
    await vi.waitFor(() => expect(el("login").hidden).toBe(false));
    expect(live.textContent).toBe("");
  } finally {
    observer.disconnect();
  }
});

it("keeps a stopped reply out of the announcement even when its terminal frame is queued", async () => {
  const reply = startReply();
  reply.frame({ text:"unfinished" });
  await vi.waitFor(() => expect(el("transcript").textContent).toContain("unfinished"));
  el("skill").focus();
  el("stop").click();
  reply.frame({ state:"complete" });
  reply.close();
  await idle();
  expect(el("announcement").textContent).toBe(mobileCatalog("en").messages.interrupted);
  expect(document.activeElement).toBe(el("skill"));
});
