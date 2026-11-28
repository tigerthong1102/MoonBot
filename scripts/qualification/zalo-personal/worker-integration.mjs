import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readSecureCredentials, writeSecureCredentials } from "../../../electron/secure-credentials.mjs";
import { createZaloInbox } from "../../../server/zalo-inbox.ts";
import { listenerLeaseFile } from "./listener-lease.mjs";

const lab = fileURLToPath(new URL(".", import.meta.url));
function worker(root, accountId) {
  const lock = listenerLeaseFile(root, accountId);
  const child = fork(join(lab, "fixture-worker.mjs"), [lock, accountId], {
    execArgv: ["--permission", "--allow-fs-read=" + lab, "--allow-fs-read=" + lock, "--allow-fs-write=" + lock, "--max-old-space-size=96"],
    env: { WS_NO_BUFFER_UTIL: "1", WS_NO_UTF_8_VALIDATE: "1" }, stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const done = once(child, "exit");
  const events = [];
  child.on("message", (reply) => { if (reply.event) events.push(reply.event); });
  return {
    events,
    ask(action, fields = {}) {
      return new Promise((resolve, reject) => {
        const failed = () => finish(new Error("worker_exited"));
        const timer = setTimeout(() => finish(new Error("worker_timeout")), 6000);
        function finish(error, value) {
          clearTimeout(timer);
          child.off("exit", failed);
          child.off("message", replied);
          if (error) reject(error); else resolve(value);
        }
        function replied(message) { if (message.state) finish(null, message.state); }
        child.once("exit", failed);
        child.on("message", replied);
        child.send({ action, ...fields }, (error) => { if (error) finish(error); });
      });
    },
    async kill() {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await done;
    },
  };
}

// Exercise the desktop's encrypted-file API. This fixture replaces the OS keyring with a throwaway RAM key.
function fixtureVault(file, grantExists) {
  const key = randomBytes(32);
  const safeStorage = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (input) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const bytes = Buffer.concat([cipher.update(input), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
    },
  };
  const load = async () => {
    if (!grantExists()) return null;
    const read = await readSecureCredentials({
      exists: () => existsSync(file), isAvailable: () => true, readFile: () => readFileSync(file),
      decrypt: (bytes) => {
        const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
        decipher.setAuthTag(bytes.subarray(12, 28));
        return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
      }, delays: [],
    });
    return grantExists() && read.status === "ok" ? read.credentials : null;
  };
  return {
    save: (synthetic) => writeSecureCredentials(file, { proof: synthetic }, safeStorage),
    load, revoke: () => rmSync(file, { force: true }),
  };
}

test("independent workers contend, recover after kill, deduplicate into durable inbox and revoke", async () => {
  const root = mkdtempSync(join(tmpdir(), "zalo-private-"));
  const file = join(root, "session.enc");
  const inboxFile = join(root, "inbox.db");
  const children = [];
  let db = new DatabaseSync(inboxFile);
  const now = () => 1795842000000;
  let inbox = createZaloInbox(db, now);
  const grant = inbox.enroll({ accountId: "10", adapter: "personal", conversationId: "20", conversationType: "group", senderId: "30", retentionDays: 1 });
  const vault = fixtureVault(file, () => !!inbox.grant(grant));
  function spawn() {
    const w = worker(root, "10");
    children.push(w);
    return w;
  }
  try {
    const secret = "synthetic-zalo-session-10";
    await vault.save(secret);
    assert.equal(readFileSync(file).includes(Buffer.from(secret)), false);
    const first = spawn(), second = spawn();
    const restore = async (w) => w.ask("restore", { credentials: await vault.load() });
    assert.equal(await restore(first), "listening");
    assert.equal(await restore(second), "listener_conflict");
    await first.ask("sample");
    const event = first.events[0];
    assert.deepEqual(event, { adapter: "personal", accountId: "10", conversationId: "20", conversationType: "group",
      senderId: "30", messageId: "50", timestamp: now(), text: "Báo giá căn hộ", direction: "incoming" });
    assert.equal(inbox.accept(event, grant), "persisted");
    await first.kill();
    db.close();
    db = new DatabaseSync(inboxFile);
    inbox = createZaloInbox(db, now);
    assert.equal(await restore(second), "listening");
    await second.ask("sample");
    assert.equal(inbox.accept(second.events[0], grant), "duplicate");
    assert.equal(inbox.read(grant).length, 1);
    assert.equal(inbox.coverage(grant).completeHistory, false);
    assert.equal(await second.ask("disconnect"), "coverage_unknown");
    const third = spawn();
    assert.equal(await restore(third), "listening");
    await third.ask("remove");
    await third.ask("sample");
    assert.deepEqual(third.events, []);
    inbox.revoke(grant);
    assert.equal(await vault.load(), null);
    vault.revoke();
    assert.equal(existsSync(file), false);
    assert.equal(inbox.accept(event, grant), "revoked");
    await third.kill();
    assert.equal(await restore(spawn()), "authentication_required");
  } finally {
    await Promise.all(children.map((w) => w.kill()));
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
