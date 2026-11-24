import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AppTriggerTestReceipts } from "./app-trigger-test-receipts.ts";
import { RoutineManager } from "./routines.ts";

const script = `
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { AppTriggerTestReceipts } from './server/app-trigger-test-receipts.ts';
import { RoutineManager } from './server/routines.ts';
const dir = process.env.OMB_TEST_ROOT, at = 1000;
const journal = new AppTriggerTestReceipts(join(dir, 'journal.json'), () => at);
const routines = new RoutineManager({ file: join(dir, 'routines.json'), now: () => at, botState: () => 'busy', createTask: () => ({ threadId: 'fixture' }), startTurn: async () => {} });
const identity = { actor: 'fixture-owner', requestKey: randomUUID(), botId: 'bot', triggerId: 'trigger', remoteId: 'remote', accountId: 'account' };
const receipt = journal.reserve(identity).receipt;
const token = journal.begin(identity.actor, receipt.id).token;
const deliveryId = 'test_' + randomUUID();
const claimed = journal.claim(token, identity.remoteId, deliveryId);
let run = null;
if (process.env.OMB_TEST_PHASE === 'after') {
  if (!journal.beginAdmission(claimed.permit)) throw new Error('Synthetic admission refused');
  run = routines.enqueueWebhook({ webhookId: identity.triggerId, webhookName: 'Fixture', prompt: 'Synthetic', botId: identity.botId, runOn: 'maus', deliveryId, receivedAt: at, eventSource: 'app', receiptScope: 'app-test' });
}
process.stdout.write('FIXTURE:' + JSON.stringify({ receipt, token, deliveryId, runId: run?.id }) + '\\n');
setInterval(() => {}, 1000);
`;

it.each(["before", "after"])("keeps the test uncertain or finds its held run after a real kill %s enqueue", async phase => {
  const dir = mkdtempSync(join(tmpdir(), "trigger-test-kill-"));
  const env = { PATH: process.env.PATH, HOME: dir, USERPROFILE: dir, OMB_DATA_DIR: dir, OMB_TEST_ROOT: dir, OMB_TEST_PHASE: phase, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
  let child: ChildProcess | undefined;
  let finished: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
  try {
    child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
    let exited = false;
    finished = new Promise((resolve, reject) => {
      child!.once("error", reject);
      child!.once("exit", (code, signal) => { exited = true; resolve({ code, signal }); });
    });
    let stdout = "", stderr = "";
    child.stdout!.on("data", data => { stdout += data; });
    child.stderr!.on("data", data => { stderr += data; });
    await expect.poll(() => { if (exited) throw new Error(`Fixture exited early: ${stderr.slice(-1000)}`); return stdout.split("\n").slice(0, -1).some(item => item.startsWith("FIXTURE:")); }, { timeout: 20000, message: "fixture must reach the crash boundary" }).toBe(true);
    const line = stdout.split("\n").find(item => item.startsWith("FIXTURE:"));
    if (!line) throw new Error(`Fixture did not start: ${stderr}`);
    const result = JSON.parse(line.slice("FIXTURE:".length)) as { receipt: { id: string }; token: string; deliveryId: string; runId?: string };
    expect(child.kill("SIGKILL")).toBe(true);
    const termination = await finished;
    if (process.platform === "win32") expect(termination.signal === "SIGKILL" || (termination.code !== null && termination.code !== 0)).toBe(true);
    else expect(termination.signal).toBe("SIGKILL");
    const now = () => 1_000 + 8 * 24 * 60 * 60_000;
    const journal = new AppTriggerTestReceipts(join(dir, "journal.json"), now);
    const routines = new RoutineManager({ file: join(dir, "routines.json"), now, botState: () => "busy", createTask: () => ({ threadId: "fixture" }), startTurn: async () => {} } as ConstructorParameters<typeof RoutineManager>[0]);
    try {
      const pending = journal.processingForReconciliation();
      expect(pending).toMatchObject([{ receipt: { id: result.receipt.id, state: "processing" }, binding: { triggerId: "trigger" }, eventId: result.deliveryId }]);
      expect(JSON.stringify(pending)).not.toContain(result.token);
      expect(journal.claim(result.token, "remote", result.deliveryId)).toMatchObject({ fresh: false, eventId: result.deliveryId, receipt: { state: "processing" } });
      const held = routines.webhookRunReceipt("trigger", result.deliveryId, "app-test");
      if (phase === "after") {
        expect(held?.id).toBe(result.runId);
        expect(journal.settle(result.receipt.id, "handled", held!.id)?.runId).toBe(result.runId);
        expect(routines.listRuns()).toEqual([expect.objectContaining({ id: result.runId, botId: "bot", webhookId: "trigger", eventSource: "app", deliveryId: result.deliveryId, receiptScope: "app-test" })]);
        routines.close();
        const reopened = new RoutineManager({ file: join(dir, "routines.json"), now, botState: () => "busy", createTask: () => ({ threadId: "fixture" }), startTurn: async () => {} } as ConstructorParameters<typeof RoutineManager>[0]);
        try {
          expect(reopened.webhookRunReceipt("trigger", result.deliveryId, "app-test")?.id).toBe(result.runId);
          expect(new AppTriggerTestReceipts(join(dir, "journal.json"), now).claim(result.token, "remote", result.deliveryId)).toMatchObject({ fresh: false, receipt: { state: "handled", runId: result.runId } });
        } finally { reopened.close(); }
      } else {
        expect(held).toBeNull();
        expect(routines.listRuns()).toHaveLength(0);
      }
    } finally { routines.close(); }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await finished?.catch(() => undefined); }
    rmSync(dir, { recursive: true, force: true });
  }
}, 45000);
