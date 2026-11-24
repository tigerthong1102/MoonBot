import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { brokerClient } from "./app-trigger-broker.ts";
import { createAppTriggerTestCoordinator } from "./app-trigger-test-coordinator.ts";
import { AppTriggerTestReceipts } from "./app-trigger-test-receipts.ts";
import { AppTriggerManager } from "./app-triggers.ts";
import { RoutineManager } from "./routines.ts";
import { startBrokerFake } from "./testing/broker-fake.ts";

const childScript = `
import { join } from 'node:path';
import { writeSync } from 'node:fs';
import { brokerClient } from './server/app-trigger-broker.ts';
import { createAppTriggerTestCoordinator } from './server/app-trigger-test-coordinator.ts';
import { AppTriggerTestReceipts } from './server/app-trigger-test-receipts.ts';
import { AppTriggerManager } from './server/app-triggers.ts';
import { RoutineManager } from './server/routines.ts';
const dir=process.env.OMB_TEST_ROOT;
const broker=brokerClient(()=>({url:process.env.OMB_TEST_URL,token:process.env.OMB_TEST_TOKEN}),fetch,{strictEvents:true});
const journal=new AppTriggerTestReceipts(join(dir,'journal.json'),Date.now,{requireExisting:true});
const routines=new RoutineManager({file:join(dir,'runs.json'),botState:()=> 'busy',createTask:()=>({threadId:'fixture'}),startTurn:async()=>{}});
const boundary=()=>{writeSync(1,'BOUNDARY\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000)};
const coordinator=createAppTriggerTestCoordinator({receipts:journal,validate:()=>null,admit:(binding,eventId)=>{if(process.env.OMB_TEST_PHASE==='before')boundary();const run=routines.enqueueWebhook({webhookId:binding.triggerId,webhookName:'Fixture',prompt:'Synthetic',botId:binding.botId,runOn:'maus',deliveryId:eventId,receivedAt:Date.now(),eventSource:'app',receiptScope:'app-test'});if(process.env.OMB_TEST_PHASE==='after')boundary();return run},proof:(binding,eventId)=>routines.webhookRunReceipt(binding.triggerId,eventId,'app-test')});
const manager=new AppTriggerManager({file:join(dir,'triggers.json'),broker,service:()=>({available:true}),connectedApps:async()=>({}),botState:()=> 'ready',routeTestEvent:event=>{const outcome=coordinator.receive(event);if(process.env.OMB_TEST_PHASE==='settled')boundary();return outcome},runs:{enqueue:input=>routines.enqueueWebhook(input),merge:(...args)=>routines.mergeIntoQueuedRun(...args),receipt:(...args)=>routines.webhookRunReceipt(...args),pending:id=>routines.activeWebhookRunCount(id),cancelQueued:(...args)=>routines.cancelQueuedWebhook(...args)}});
await manager.pollOnce(undefined,0);
if(process.env.OMB_TEST_PHASE==='after-cursor')boundary();
throw new Error('Boundary was not reached');
`;

it.each(["before", "after", "settled", "after-cursor"])("keeps the broker event recoverable after process kill %s admission", async phase => {
  const dir = mkdtempSync(join(tmpdir(), "broker-test-kill-")), fake = await startBrokerFake();
  const owner = await fake.install(), account = fake.account(owner.userId, "gmail", "fixture");
  const broker = brokerClient(() => ({ url: fake.url, token: owner.token }), fetch, { strictEvents: true });
  const runsFile = join(dir, "runs.json"), triggerFile = join(dir, "triggers.json"), journalFile = join(dir, "journal.json");
  const openRuns = () => new RoutineManager({ file: runsFile, botState: () => "busy", createTask: () => ({ threadId: "fixture" }), startTurn: async () => {} });
  let routines = openRuns(), child: ChildProcess | undefined;
  let finished: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
  try {
    const initial = new AppTriggerManager({ file: triggerFile, broker, service: () => ({ available: true }), connectedApps: async () => ({ gmail: { connected: true, accounts: [{ id: account, status: "ACTIVE" }] } }), botState: () => "ready", runs: { enqueue: input => routines.enqueueWebhook(input), merge: (...args) => routines.mergeIntoQueuedRun(...args), receipt: (...args) => routines.webhookRunReceipt(...args), pending: id => routines.activeWebhookRunCount(id), cancelQueued: (...args) => routines.cancelQueuedWebhook(...args) } });
    const trigger = await initial.create({ botId: "bot", name: "Fixture", prompt: "Synthetic", app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE" });
    const journal = new AppTriggerTestReceipts(journalFile), identity = { actor: "owner", requestKey: randomUUID(), botId: "bot", triggerId: trigger.id, remoteId: trigger.remote.triggerId!, accountId: account };
    const receipt = journal.reserve(identity).receipt, begun = journal.begin(identity.actor, receipt.id)!;
    const event = await broker.testEventReceipt!(identity.remoteId, { omb_test: true, note: "A test run started from StartupBot.", marker: begun.token });
    routines.close();
    const env = { PATH: process.env.PATH, HOME: dir, USERPROFILE: dir, OMB_DATA_DIR: dir, OMB_TEST_ROOT: dir, OMB_TEST_URL: fake.url, OMB_TEST_TOKEN: owner.token, OMB_TEST_PHASE: phase, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
    child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", childScript], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", exited = false;
    child.stdout!.on("data", data => { stdout += data; }); child.stderr!.on("data", data => { stderr += data; });
    finished = new Promise((resolve, reject) => { child!.once("error", reject); child!.once("exit", (code, signal) => { exited = true; resolve({ code, signal }); }); });
    await expect.poll(() => { if (exited) throw new Error(`Fixture exited early: ${stderr.slice(-1000)}`); return stdout.includes("BOUNDARY\n"); }, { timeout: 20000 }).toBe(true);
    expect(child.kill("SIGKILL")).toBe(true);
    const termination = await finished;
    if (process.platform === "win32") expect(termination.signal === "SIGKILL" || (termination.code !== null && termination.code !== 0)).toBe(true);
    else expect(termination.signal).toBe("SIGKILL");
    routines = openRuns();
    const reopened = new AppTriggerTestReceipts(journalFile, Date.now, { requireExisting: true });
    const coordinator = createAppTriggerTestCoordinator({ receipts: reopened, validate: () => null, admit: () => { throw new Error("Must not admit on replay"); }, proof: (binding, id) => routines.webhookRunReceipt(binding.triggerId, id, "app-test") });
    const recovered = new AppTriggerManager({ file: triggerFile, broker, service: () => ({ available: true }), connectedApps: async () => ({}), botState: () => "ready", routeTestEvent: item => coordinator.receive(item), runs: { enqueue: input => routines.enqueueWebhook(input), merge: (...args) => routines.mergeIntoQueuedRun(...args), receipt: (...args) => routines.webhookRunReceipt(...args), pending: id => routines.activeWebhookRunCount(id), cancelQueued: (...args) => routines.cancelQueuedWebhook(...args) } });
    if (phase === "before") {
      await expect(recovered.pollOnce(undefined, 0)).rejects.toThrow("Could not safely process app test event");
      expect(routines.listRuns()).toHaveLength(0);
      expect(reopened.find(identity.actor, receipt.id)?.state).toBe("processing");
      expect(JSON.parse(readFileSync(triggerFile, "utf8")).cursor).toBe(0);
    } else {
      expect(await recovered.pollOnce(undefined, 0)).toBe(phase === "after-cursor" ? 0 : 1);
      expect(routines.listRuns()).toHaveLength(1);
      expect(reopened.find(identity.actor, receipt.id)).toMatchObject({ state: "handled", runId: routines.listRuns()[0]!.id });
      expect(JSON.parse(readFileSync(triggerFile, "utf8")).cursor).toBe(event.seq);
      expect(await recovered.pollOnce(undefined, 0)).toBe(0);
      expect(readFileSync(runsFile, "utf8")).not.toContain(begun.token);
    }
    for (const file of [journalFile, triggerFile]) expect(readFileSync(file, "utf8")).not.toContain(begun.token);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await finished?.catch(() => undefined); }
    routines.close(); await fake.close(); rmSync(dir, { recursive: true, force: true });
  }
}, 45000);
