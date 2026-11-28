import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { acquireListenerLease } from "./listener-lease.mjs";
import { createPersonalSessions } from "./personal.mjs";

const { GroupMessage } = createRequire(import.meta.url)("zca-js");
const [leasePath, accountId] = process.argv.slice(2);
if (!process.permission || process.permission.has("net") || process.permission.has("child") ||
    process.permission.has("fs.write", process.cwd()) || !process.send) {
  throw new Error("isolated_fixture_worker_required");
}
const fixtureCredential = "synthetic-zalo-session-" + accountId;
const listener = new EventEmitter();
listener.start = () => listener.emit("connected");
listener.stop = () => {};
const client = {
  login: async (credentials) => {
    if (credentials?.proof !== fixtureCredential) throw new Error("fixture_authentication");
    return { getOwnId: () => accountId, listener };
  },
};
const manager = createPersonalSessions();
let session;
let release;
process.on("disconnect", () => process.exit(0));
process.on("message", async (request) => {
  if (request?.action === "restore" && !session) {
    try {
      release = acquireListenerLease(leasePath);
    } catch (error) {
      return process.send({ state: error.message === "listener_conflict" ? "listener_conflict" : "lease_unavailable" });
    }
    session = manager.begin({
      accountId, conversations: [{ type: "group", id: "20" }], client,
      restoreCredentials: () => request.credentials,
      onState: () => {}, onQr: () => { throw new Error("unexpected_qr"); },
      onMessage: (event) => process.send({ event }),
    });
    await session.ready;
    if (session.status() !== "listening") release();
    return process.send({ state: session.status() });
  }
  if (!session || session.status() !== "listening") return process.send({ state: "disconnected" });
  if (request?.action === "remove") session.removeConversation("group", "20");
  if (request?.action === "disconnect") {
    listener.emit("closed", 1006);
    release();
  }
  if (request?.action === "sample") {
    const sample = new GroupMessage(accountId, {
      msgId: "50", idTo: "20", uidFrom: "30", ts: "1795842000000", msgType: "webchat", content: "Báo giá căn hộ",
    });
    listener.emit("message", sample);
  }
  process.send({ state: session.status() });
});
