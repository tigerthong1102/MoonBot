import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { registerInboxVoice, installInboxVoice } from "./personal-inbox-voice.mjs";

function fixture() {
  const origin = "https://inbox.example.test";
  const mainFrame = { url: origin + "/?desktop=1" };
  const calls = [], handlers = new Map();
  let check, request, local = true;
  const page = {
    mainFrame, getURL: () => mainFrame.url,
    send: (...args) => calls.push(["page", ...args]),
    session: { setPermissionCheckHandler: callback => check = callback, setPermissionRequestHandler: callback => request = callback },
  };
  const workspace = { send: (...args) => calls.push(["workspace", ...args]), isDestroyed: () => false };
  const dispose = registerInboxVoice({ page, workspace, origin, localWorkspace: () => local, requestMicrophone: async () => true });
  installInboxVoice({ handle: (name, callback) => handlers.set(name, callback) }, (_name, callback) => callback,
    event => assert.equal(event.sender, workspace));
  return {
    invoke: (name, sender, ...args) => handlers.get("personal-inbox:" + name)(sender, ...args), page, workspace,
    check: (permission, requesting, details, contents = page) => check(contents, permission, requesting, details),
    request: (permission, details) => { let result; request(page, permission, allow => result = allow, details); return result; },
    source: { sender: page, senderFrame: mainFrame }, origin, mainFrame, calls, dispose, remote: () => local = false,
  };
}

test("microphone access is scoped to an armed Inbox main frame at its configured URL", async () => {
  const f = fixture();
  const audio = { isMainFrame: true, mediaType: "audio" };
  assert.equal(f.check("media", f.origin, audio), false);
  assert.equal(await f.invoke("request-microphone", { ...f.source, senderFrame: { url: f.mainFrame.url } }), false);
  assert.equal(await f.invoke("request-microphone", f.source), true);
  assert.equal(f.check("media", f.origin, audio), true);
  assert.equal(f.check("media", f.origin, { ...audio, mediaType: "video" }), false);
  assert.equal(f.check("media", f.origin, { ...audio, isMainFrame: false }), false);
  assert.equal(f.check("media", f.origin, audio, {}), false);
  assert.equal(f.check("media", "https://other.example.test", audio), false);
  assert.equal(f.request("media", { isMainFrame: true, mediaTypes: ["audio"], requestingUrl: f.mainFrame.url }), true);
  assert.equal(f.request("media", { isMainFrame: true, mediaTypes: [], requestingUrl: f.mainFrame.url }), false);
  f.dispose.reset();
  assert.equal(f.check("media", f.origin, audio), false);
  f.mainFrame.url = f.origin + "/other";
  assert.equal(await f.invoke("request-microphone", f.source), false);
  f.dispose.close();
});

test("only the originating Inbox gets the active dictation result and closing cancels the session", () => {
  const f = fixture(), id = randomUUID(), stale = randomUUID();
  assert.equal(f.invoke("dictate", f.source, "start", id), true);
  assert.equal(f.invoke("dictate", f.source, "finish", stale), false);
  f.invoke("dictation-result", { sender: f.workspace }, stale, { text: "stale" });
  f.invoke("dictation-result", { sender: f.workspace }, id, { text: "a note" });
  assert.deepEqual(f.calls, [
    ["workspace", "personal-inbox:dictation-command", { id, action: "start" }],
    ["page", "personal-inbox:dictation", { id, text: "a note" }],
  ]);
  f.dispose.close();
  assert.deepEqual(f.calls.at(-1), ["workspace", "personal-inbox:dictation-command", { id, action: "cancel" }]);
  assert.equal(f.invoke("dictate", f.source, "start", stale), false);
  const another = fixture();
  another.remote();
  assert.equal(another.invoke("dictate", another.source, "start", stale), false);
});
