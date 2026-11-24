import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const base = "http://127.0.0.1:25380";
async function waitFor(read, message) {
  for (let pass = 0; pass < 130; pass++) {
    const result = await read().catch(() => null);
    if (result) return result;
    await delay(500);
  }
  throw new Error(message);
}
const health = await waitFor(() => fetch(base + "/api/health").then(r => r.json()), "Installed server did not start");
assert.equal(health.version, "1.0.1");
const target = await waitFor(async () => {
  const tabs = await fetch("http://127.0.0.1:25382/json/list").then(r => r.json());
  return tabs.find(item => item.type === "page" && item.url.startsWith(base));
}, "Installed renderer did not open");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let sequence = 0;
function evaluate(expression) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    function receive(event) {
      const result = JSON.parse(event.data);
      if (result.id !== id) return;
      socket.removeEventListener("message", receive);
      if (result.result.exceptionDetails) reject(new Error(result.result.exceptionDetails.text));
      else resolve(result.result.result.value);
    }
    socket.addEventListener("message", receive);
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  });
}
try {
  await waitFor(() => evaluate("Boolean(window.ogb?.openPersonalInbox)"), "Installed desktop Inbox bridge unavailable");
  await evaluate("window.ogb.openPersonalInbox()");
  await waitFor(() => evaluate('Boolean(document.querySelector("[data-personal-account-dialog] input[name=email]"))'), "Email sign-in inside the installed app did not open");
  console.log("NSIS-installed StartupBot 1.0.1 started and opened the in-app Inbox sign-in");
} finally {
  socket.close();
}
