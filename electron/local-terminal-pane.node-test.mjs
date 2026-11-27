import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { localTerminalPane, registerLocalTerminalPane } from "./local-terminal-pane.mjs";

test("an embedded frame cannot access terminal inventory", async () => {
  let invoke;
  registerLocalTerminalPane({ handle(_key, f) { invoke = f; } }, (_key, f) => f, () => "/test");
  assert.throws(() => invoke({ senderFrame: {}, sender: { mainFrame: {} } }, "list"), /main desktop/);
});
test("desktop inventory, exact session, literal input, readback and profile isolation", { skip: process.platform === "win32" || spawnSync("tmux", ["-V"]).status !== 0 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "startupbot-pane-"));
  const socket = "startupbot-" + createHash("sha256").update(dir).digest("hex").slice(0, 24);
  const args = ["-f","/dev/null","-L",socket];
  try {
    execFileSync("tmux", [...args,"new-session","-d","-s","sample","/bin/cat"]);
    const [session] = await localTerminalPane(dir, "list");
    assert.equal(session.name, "sample");
    assert.deepEqual(await localTerminalPane(join(dir,"other"), "list"), []);
    await assert.rejects(localTerminalPane(dir,"send","unknown","x"));
    await assert.rejects(localTerminalPane(dir,"send",session.id,"two\nlines"));
    await localTerminalPane(dir,"send",session.id,"literal ; echo $PATH");
    for (let i=0; i<30; i++) {
      if ((await localTerminalPane(dir,"read",session.id)).includes("literal ; echo $PATH")) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail("No terminal readback");
  } finally {
    spawnSync("tmux", [...args,"kill-server"]);
    rmSync(dir, { recursive:true, force:true });
  }
});

test("concurrent terminal submissions reach the child as separate complete lines", {
  skip: process.platform === "win32" || spawnSync("tmux", ["-V"]).status !== 0,
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), "startupbot-pane-input-"));
  const socket = "startupbot-" + createHash("sha256").update(dir).digest("hex").slice(0, 24);
  const args = ["-f", "/dev/null", "-L", socket];
  const receipt = join(dir, "received.txt");
  try {
    execFileSync("tmux", [...args, "new-session", "-d", "-s", "reader", "sh", "-c", 'exec cat > "$1"', "sh", receipt]);
    const [pane] = await localTerminalPane(dir, "list");
    const lines = Array.from({ length: 12 }, (_, i) => "submission-" + i);
    await Promise.all(lines.map(line => localTerminalPane(dir, "send", pane.id, line)));
    let received = "";
    for (let i = 0; i < 40; i++) {
      received = readFileSync(receipt, "utf8");
      if (received.split("\n").length > lines.length) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.deepEqual(received.trimEnd().split("\n").sort(), lines.sort());
  } finally {
    spawnSync("tmux", [...args, "kill-server"]);
    rmSync(dir, { recursive: true, force: true });
  }
});
