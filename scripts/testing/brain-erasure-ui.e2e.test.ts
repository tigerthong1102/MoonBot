import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { resolveAgentBrowserBinary } from "../../server/browser-engine.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { agentBrowser, sessionEnv, UI_TOOLS_DIR, type UiHandle } from "./control-omb-ui.ts";

const enabled = process.env.OMB_UI_E2E === "1" || Boolean(resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env }));
it.skipIf(!enabled)("erases private page revisions across two browser tabs and preserves other owners and sources", async () => {
  const launcher = fileURLToPath(new URL("../control-omb.ts", import.meta.url));
  const child = spawn(process.execPath, ["--experimental-strip-types", launcher, "ui", "launch"], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", errors = "";
  child.stdout.on("data", chunk => { out += String(chunk); });
  child.stderr.on("data", chunk => { errors += String(chunk); });
  try {
    const info = await new Promise<{ ui: string }>((resolve, reject) => {
      AbortSignal.timeout(600_000).addEventListener("abort", () => reject(new Error("Fixture startup timed out")), { once: true });
      child.stdout.on("data", () => { try { resolve(JSON.parse(out)); } catch { /* A pipe can split a JSON object. */ } });
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Fixture exited: " + errors)));
    });
    const handle: UiHandle = JSON.parse(readFileSync(info.ui, "utf8"));
    const command = (args: string[]) => agentBrowser(handle.binary, sessionEnv(handle), args);
    const evaluate = async (js: string) => (await command(["eval", js])).result;
    const click = async (label: string) => {
      await expect.poll(() => evaluate(`(() => {
        const button = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled);
        if (!button) return false;
        button.click();
        return true;
      })()`)).toBe(true);
    };
    const setup = `const brain = await import("/src/components/knowledge/brain.ts");
      const { browserRecord } = await import("/src/lib/browser-records.ts");
      const signal = new AbortController().signal;
      const bot = (await (await fetch("/api/bots")).json()).bots.find(b => b.id === ${JSON.stringify(handle.botId)});
      const open = async () => (await import("/src/components/conversation-share/conversation-share.ts")).openConversationDialog({
        kind: "brain", botId: bot.id, threadId: bot.threadId
      });`;
    const selected = await evaluate(`(async () => { ${setup}
      const messages = (await (await fetch("/api/threads/"+bot.threadId+"/messages?limit=20")).json()).messages;
      const msg = messages.find(m => m.kind === "text");
      const evidence = await brain.evidenceReader("local", signal)({kind:"message", threadId:bot.threadId, messageId:msg.id});
      const one = await brain.approvePage({...brain.newPage("local",evidence), title:"Visible fixture", body:"Erase revision one"},signal);
      const two = await brain.approvePage({...one, body:"Erase revision two"},signal);
      const hidden = {...two, id:"unavailable", version:1, title:"Hidden fixture metadata", body:"Hidden body",
        source:{...two.source, messageId:"missing-message"}};
      await browserRecord("readwrite", s => s.add(hidden,["brain","local",hidden.id,1]));
      await browserRecord("readwrite", s => s.add({...hidden,owner:"other-browser-account"},["brain","other-browser-account",hidden.id,1]));
      await open();
      return two;
    })()`) as { id: string; version: number };
    await expect.poll(() => evaluate('document.querySelector("article")?.textContent')).toContain("Erase revision two");
    const denials = await evaluate(`(async () => { ${setup}
      const { forgetBrainPages } = await import("/src/components/knowledge/brain-erasure.ts");
      const realFetch = window.fetch;
      const outcomes = [];
      try {
        for (const reply of [Response.json({}), new Response("<html>Sign in</html>"), Response.json({
          kind:"session",environmentId:"fixture",id:"other-session",label:"Other",scopes:["client"],expiresAt:Date.now()+60000,via:"cookie"
        })]) {
          window.fetch = (url, init) => url === "/api/auth/session" ? Promise.resolve(reply) : realFetch(url, init);
          outcomes.push(await forgetBrainPages("local",null,signal).then(()=>true,()=>false));
        }
      } finally { window.fetch = realFetch; }
      return { outcomes, versions: (await brain.pageHistory("local")).length };
    })()`);
    expect(denials).toEqual({outcomes:[false,false,false],versions:3});
    await click("Forget this page"); await click("Cancel");
    expect(await evaluate('document.body.textContent.includes("Hidden fixture metadata")')).toBe(false);

    await click("Review page");
    expect(await evaluate('document.querySelector("[role=dialog] textarea")?.value')).toBe("Erase revision two");
    await command(["tab", "new", "--label", "owner", handle.previewUrl]);
    await evaluate(`(async () => { ${setup} await open(); return true; })()`);
    await click("Forget this page"); await click("Delete");
    await expect.poll(() => evaluate('document.querySelectorAll("article").length')).toBe(0);
    await command(["tab", "t1"]);
    await expect.poll(() => evaluate('document.querySelectorAll("article").length')).toBe(0);
    await expect.poll(() => evaluate('document.querySelector("[role=dialog] textarea") === null')).toBe(true);
    const stale = await evaluate(`(async () => { ${setup}
      const old = ${JSON.stringify(selected)};
      const { withCurrentBrainPage } = await import("/src/components/knowledge/brain-erasure.ts");
      const approve = await brain.approvePage(old,signal).then(()=>true,()=>false);
      const publish = await withCurrentBrainPage(old,signal,()=>true).catch(()=>false);
      const legacy = await browserRecord("readwrite",s=>s.add({...old, version:3},["brain","local",old.id,3])).then(()=>true,()=>false);
      return { approve, publish, legacy };
    })()`);
    expect(stale).toEqual({approve:false, publish:false, legacy:false});

    await click("Forget all saved pages"); await click("Delete");
    await expect.poll(() => evaluate('document.querySelector("[role=alertdialog]") === null')).toBe(true);
    const stored = await evaluate(`(async () => { ${setup}
      const rows = await browserRecord("readonly", s=>s.getAll());
      const personal = await browserRecord("readonly", s=>s.getAll(IDBKeyRange.bound(["brain","local"],["brain","local",[]])));
      const other = await brain.pageHistory("other-browser-account");
      const retained = (await (await fetch("/api/threads/"+bot.threadId+"/messages?limit=20")).json()).messages.length;
      return { allErased:personal.length > 0 && personal.every(row=>row.forgotten && Object.keys(row).sort().join(",")==="forgotten,id,version"),
        other:other.map(p=>p.body), metadata:JSON.stringify(rows.filter(row=>row.owner!=="other-browser-account")).includes("Hidden fixture metadata"), retained:retained>0 };
    })()`);
    expect(stored).toEqual({allErased:true, other:["Hidden body"], metadata:false, retained:true});
  } finally {
    if (child.exitCode === null && child.signalCode === null) await waitForExit(child, { signal: "SIGINT", graceMs: 30_000 });
  }
}, 660_000);
