import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { createControlPlaneClient, ControlPlaneError } from "../../electron/control-plane-client.mjs";
import { mobileCatalog, preferredMobileLanguage, renderMobilePage } from "./mobile-catalog.mjs";
import { mobileSessions } from "./mobile-sessions.mjs";
import { catalog, Fault } from "./ledger.mjs";

import { inboxSkinCSS } from "../../cloudflare/control-plane/inbox/skin-css.mjs";

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const inboxPublic = "../../cloudflare/control-plane/inbox/public/";
const assets = new Map([
  ["/mobile", ["./mobile.html", "text/html"]],
  ["/mobile/app.js", ["./mobile-ui.js", "application/javascript"]],
  ["/mobile/inbox-select.js", [inboxPublic + "inbox-select.js", "application/javascript"]],
  ["/mobile/inbox-select-template.js", [inboxPublic + "inbox-select-template.js", "application/javascript"]],
  ["/mobile/inbox-select.css", [inboxPublic + "inbox-select.css", "text/css"]],
]);
const instructions = "You are StartupBot on a phone. Answer in the user's language. You can write, translate and explain text. You have no access to a computer, local files, apps, cloud agent or tools. If a request needs them, explain that it needs a connected computer. Never state that an external action was performed.";

const textSkills = new Map([
  ["chat", ""], ["write", "Help draft the requested text."],
  ["translate", "Translate only the supplied text into the language requested. Ask for the target language when missing."],
  ["summarize", "Summarize only the text supplied by the user. Ask for the text when missing."]
]);

export function mobileService(ledger, settings, gateway, http, readObject) {
  if (!settings.mobileOrigin) return null;
  const origin = new URL(settings.mobileOrigin);
  if (origin.origin !== settings.mobileOrigin || origin.protocol !== "https:") throw new Error("Invalid mobile HTTPS origin");
  const accounts = createControlPlaneClient({ baseURL: settings.accountOrigin, fetchImpl: http });
  const db = ledger.db;
  const clipboard = stripTypeScriptTypes(readFileSync(new URL("../../src/lib/clipboard-write.ts", import.meta.url), "utf8"));
  const skin = inboxSkinCSS(readFileSync(new URL("../../src/styles.css", import.meta.url), "utf8"));
  const sessions = mobileSessions(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS mobile_threads(owner TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,updated INTEGER NOT NULL,
      PRIMARY KEY(owner,id));
    CREATE TABLE IF NOT EXISTS mobile_turns(owner TEXT NOT NULL,thread TEXT NOT NULL,id TEXT NOT NULL,prompt TEXT NOT NULL,
      answer TEXT NOT NULL DEFAULT '',state TEXT NOT NULL,created INTEGER NOT NULL,
      PRIMARY KEY(owner,id), FOREIGN KEY(owner,thread) REFERENCES mobile_threads(owner,id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS mobile_turn_order ON mobile_turns(owner,thread,created);
    CREATE INDEX IF NOT EXISTS mobile_thread_order ON mobile_threads(owner,updated);
  `);
  db.exec("CREATE TABLE IF NOT EXISTS mobile_identity_authority(singleton INTEGER PRIMARY KEY CHECK(singleton=1),origin TEXT NOT NULL)");
  db.prepare("INSERT OR IGNORE INTO mobile_identity_authority VALUES (1,?)").run(accounts.origin);
  if (db.prepare("SELECT origin FROM mobile_identity_authority WHERE singleton=1").get().origin !== accounts.origin)
    throw new Error("Mobile account issuer differs from the existing database");
  const lists = db.prepare("SELECT id,title,updated FROM mobile_threads WHERE owner=? ORDER BY updated DESC,id LIMIT 50");
  const history = db.prepare("SELECT id,prompt,answer,state,created FROM mobile_turns WHERE owner=? AND thread=? ORDER BY created,rowid LIMIT 80");
  const lookup = db.prepare("SELECT id FROM mobile_threads WHERE owner=? AND id=?");
  const finish = db.prepare("UPDATE mobile_turns SET state=?,answer=? WHERE owner=? AND id=? AND state='running'");
  function recover(owner) {
    db.prepare("UPDATE mobile_turns SET state='interrupted' WHERE owner=? AND state='running' AND created<?")
      .run(owner, Date.now() - 5 * 60000);
  }
  return async (req, res, path, json) => {
    const method = req.method;
    if (method === "POST" && (req.headers.origin !== origin.origin || !req.headers["content-type"]?.startsWith("application/json")))
      throw new Fault(403, "origin_denied");
    if (method === "GET" && path === "/mobile/clipboard-write.js") {
      res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
      return res.end(clipboard);
    }
    if (method === "GET" && path === "/mobile/messages") {
      return json(200, mobileCatalog(new URL(req.url, origin).searchParams.get("lang")));
    }
    if (method === "GET" && path === "/mobile/skin.css") {
      res.writeHead(200, { "content-type":"text/css; charset=utf-8" });
      return res.end(skin);
    }
    if (assets.has(path) && method === "GET") {
      const [file, type] = assets.get(path);
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      if (type === "text/html") {
        const tag = new URL(req.url, origin).searchParams.get("lang") || preferredMobileLanguage(req.headers["accept-language"]);
        const page = renderMobilePage(source, mobileCatalog(tag));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", vary: "Accept-Language" });
        return res.end(page);
      }
      res.writeHead(200, { "content-type": type + "; charset=utf-8" });
      return res.end(source);
    }
    const body = method === "POST" ? await readObject(req) : {};
    let owner;
    try {
      if (method === "POST" && path === "/mobile/code") {
        await accounts.requestOTP(body.email);
        return json(200, { ok: true });
      }
      if (method === "POST" && path === "/mobile/login") {
        const { accountToken, user } = await accounts.verifyOTP(body.email, body.otp);
        sessions.issue(res, user.id, accountToken);
        return json(200, { ok: true });
      }
      const session = sessions.read(req);
      if (method === "POST" && path === "/mobile/logout") {
        sessions.revoke(res, session.hash);
        try { await accounts.signOut(session.token); } catch (error) {
          if (!(error instanceof ControlPlaneError)) throw error;
        }
        return json(200, { ok: true });
      }
      const user = await accounts.me(session.token, { requireVerifiedEmail: true });
      if (user.id !== session.owner) throw new Fault(401, "signed_out");
      owner = user.id;
    } catch (error) {
      if (!(error instanceof ControlPlaneError)) throw error;
      if (error.status === 429) throw new Fault(429, "account_rate_limit");
      if (error.status >= 500 || ["network_unavailable", "control_plane_unavailable", "invalid_response"].includes(error.code)) throw new Fault(503, "account_unavailable");
      throw new Fault(401, "signed_out");
    }
    recover(owner);
    if (method === "GET" && path === "/mobile/threads") return json(200, { account: owner, threads: lists.all(owner) });
    if (method !== "POST") throw new Fault(404, "not_found");
    if (body.account !== owner) throw new Fault(409, "account_changed");
    const thread = body.thread;
    if (!uuid.test(thread)) throw new Fault(400, "invalid_thread");
    if (path !== "/mobile/send" && !lookup.get(owner, thread)) throw new Fault(404, "not_found");
    if (path === "/mobile/history") return json(200, { turns: history.all(owner, thread) });
    if (path === "/mobile/delete" || path === "/mobile/rename") {
      if (path.endsWith("delete")) db.prepare("DELETE FROM mobile_threads WHERE owner=? AND id=?").run(owner, thread);
      else {
        if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 100) throw new Fault(400, "invalid_title");
        db.prepare("UPDATE mobile_threads SET title=? WHERE owner=? AND id=?").run(body.title.trim(), owner, thread);
      }
      return json(200, { ok: true });
    }
    if (path !== "/mobile/send") throw new Fault(404, "not_found");
    if (!uuid.test(body.id) || typeof body.prompt !== "string" || !body.prompt.trim() ||
        Buffer.byteLength(body.prompt) > 8192 || body.save !== true) throw new Fault(400, "invalid_message");
    if (body.runtime === "desktop" || /^(?:(?:hãy|vui lòng|please)\s+)?(?:mở|chạy|open|launch|start)\s+(?:phần mềm\s+|ứng dụng\s+)?(?:misa|excel|quickbooks)(?:\s|$|[.,!])/iu.test(body.prompt.trim()))
      throw new Fault(409, "desktop_required");
    const skill = body.skill ?? "chat";
    if (!textSkills.has(skill)) throw new Fault(400, "unsupported_skill");
    const config = catalog(settings.catalog);
    if (!config.managedLimits?.enabled) throw new Fault(503, "managed_ai_paused");
    if (res.destroyed) return;
    ledger.claimMobileTrial(owner, config);
    if (!db.prepare("SELECT 1 FROM users WHERE id=?").get(owner) ||
        !ledger.balances(owner).some(b => b.available > 0)) throw new Fault(402, "personal_credit_exhausted");
    const isNew = !lookup.get(owner, thread);
    const messages = ledger.tx(() => {
      if (db.prepare("SELECT 1 FROM mobile_turns WHERE owner=? AND id=?").get(owner, body.id))
        throw new Fault(409, "request_exists");
      if (!lookup.get(owner, thread)) {
        if (lists.all(owner).length >= 50) throw new Fault(409, "history_full");
        db.prepare("INSERT INTO mobile_threads VALUES (?,?,?,?)").run(owner, thread, body.prompt.trim().slice(0, 80), Date.now());
      }
      if (db.prepare("SELECT 1 FROM mobile_turns WHERE owner=? AND thread=? AND state='running'").get(owner, thread))
        throw new Fault(409, "turn_in_progress");
      const count = db.prepare("SELECT count(*) n FROM mobile_turns WHERE owner=? AND thread=?").get(owner, thread).n;
      if (count >= 80) throw new Fault(409, "thread_full");
      const previous = db.prepare("SELECT prompt,answer FROM mobile_turns WHERE owner=? AND thread=? AND state IN ('complete','limited') ORDER BY created DESC,rowid DESC LIMIT 8").all(owner, thread);
      const context = [];
      let size = Buffer.byteLength(body.prompt);
      for (const turn of previous) {
        size += Buffer.byteLength(turn.prompt) + Buffer.byteLength(turn.answer);
        if (size > 16384) break;
        context.unshift({ role: "user", content: turn.prompt }, { role: "assistant", content: turn.answer });
      }
      db.prepare("INSERT INTO mobile_turns(owner,thread,id,prompt,state,created) VALUES (?,?,?,?,'running',?)").run(owner, thread, body.id, body.prompt, Date.now());
      db.prepare("UPDATE mobile_threads SET updated=? WHERE owner=? AND id=?").run(Date.now(), owner, thread);
      return [{ role: "system", content: [instructions, textSkills.get(skill)].filter(Boolean).join(" ") }, ...context, { role: "user", content: body.prompt }];
    });
    const controller = new AbortController();
    res.on("close", () => controller.abort());
    if (res.destroyed) controller.abort();
    const frame = (data) => {
      if (res.destroyed) throw new Error("disconnected");
      if (!res.headersSent) res.writeHead(200, { "content-type": "application/x-ndjson", "x-accel-buffering": "no" });
      res.write(JSON.stringify(data) + "\n");
    };
    res.setHeader("x-request-id", body.id);
    try {
      const result = await gateway.run(owner, body.id, { model: config.model, messages }, config, {
        signal: controller.signal, delta: text => frame({ text }),
      });
      const choice = result.choices[0];
      const state = choice.finish_reason === "stop" ? "complete" : "limited";
      finish.run(state, choice.message.content, owner, body.id);
      frame({ state });
      res.end();
    } catch (error) {
      const charge = db.prepare("SELECT state FROM requests WHERE owner=? AND id=?").get(owner, body.id);
      if (!charge || charge.state === "retryable") {
        ledger.tx(() => {
          db.prepare("DELETE FROM mobile_turns WHERE owner=? AND id=? AND state='running'").run(owner, body.id);
          if (isNew) db.prepare("DELETE FROM mobile_threads WHERE owner=? AND id=? AND NOT EXISTS (SELECT 1 FROM mobile_turns WHERE owner=? AND thread=?)").run(owner, thread, owner, thread);
        });
      } else finish.run("interrupted", "", owner, body.id);
      if (res.destroyed) return;
      if (!res.headersSent) throw error;
      frame({ state: "interrupted" });
      res.end();
    }
  };
}
