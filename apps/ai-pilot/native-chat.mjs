import { randomUUID } from "node:crypto";
import { nativeHistory } from "./native-history.mjs";
import { Fault } from "./ledger.mjs";

export function nativePath(path) {
  return path === "/.well-known/openmausbot/environment" || path?.startsWith("/api/");
}

const threadRoute = /^\/api\/(bots|threads)\/([\da-fA-F-]{36})\/(read|messages|tasks|respond|export)(?:\/([\da-fA-F-]{36}))?$/;

export function nativeChat(ledger, lists, origin) {
  const { db } = ledger;
  const environment = { label:"StartupBot", platform:"cloud", environmentId:"startupbot-mobile:" + origin };
  const activeStreams = new Map();
  db.exec(`
    CREATE TABLE IF NOT EXISTS mobile_native_task_groups(owner TEXT NOT NULL,thread TEXT NOT NULL,bot TEXT NOT NULL,
      PRIMARY KEY(owner,thread), FOREIGN KEY(owner,thread) REFERENCES mobile_threads(owner,id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS mobile_native_task_preferences(owner TEXT NOT NULL,thread TEXT NOT NULL,value TEXT NOT NULL,
      PRIMARY KEY(owner,thread), FOREIGN KEY(owner,thread) REFERENCES mobile_threads(owner,id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS mobile_native_receipts(owner TEXT NOT NULL,id TEXT NOT NULL,session TEXT NOT NULL REFERENCES mobile_sessions(handle) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,PRIMARY KEY(owner,id), FOREIGN KEY(owner,id) REFERENCES mobile_turns(owner,id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS mobile_native_choices(session TEXT NOT NULL REFERENCES mobile_sessions(handle) ON DELETE CASCADE,
      owner TEXT NOT NULL,thread TEXT NOT NULL,id TEXT NOT NULL,prompt BLOB NOT NULL,devices TEXT NOT NULL,title TEXT NOT NULL,expires INTEGER NOT NULL,
      PRIMARY KEY(session,thread), FOREIGN KEY(owner,thread) REFERENCES mobile_threads(owner,id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS mobile_native_selection(owner TEXT NOT NULL,bot TEXT NOT NULL,thread TEXT NOT NULL,
      PRIMARY KEY(owner,bot), FOREIGN KEY(owner,thread) REFERENCES mobile_threads(owner,id) ON DELETE CASCADE);
  `);
  const assign = db.prepare("INSERT INTO mobile_native_task_groups VALUES (?,?,?)");
  function roster(owner) {
    const groups = new Map();
    const parent = new Map(db.prepare("SELECT thread,bot FROM mobile_native_task_groups WHERE owner=?").all(owner).map(row => [row.thread,row.bot]));
    const preferences = new Map(db.prepare("SELECT thread,value FROM mobile_native_task_preferences WHERE owner=?").all(owner).map(row => [row.thread,JSON.parse(row.value)]));
    const threads = lists.all(owner);
    const knownBots = new Set(parent.values());
    const home = parent.values().next().value ?? threads.at(-1)?.id;
    for (const thread of threads) {
      thread.preferences = preferences.get(thread.id) ?? {};
      const until = thread.preferences.snoozedUntil;
      if (until > 0 && until <= Date.now()) delete thread.preferences.snoozedUntil;
      const id = parent.get(thread.id) ?? (knownBots.has(thread.id) ? thread.id : home);
      if (!parent.has(thread.id)) assign.run(owner,thread.id,id);
      if (!groups.has(id)) groups.set(id,[]);
      groups.get(id).push(thread);
    }
    return groups;
  }
  const select = db.prepare("INSERT INTO mobile_native_selection VALUES (?,?,?) ON CONFLICT(owner,bot) DO UPDATE SET thread=excluded.thread");
  const { threadPage, search, exportTranscript } = nativeHistory(db);
  function create(owner, title = "StartupBot") {
    if (lists.all(owner).length >= 50) throw new Fault(409, "history_full");
    const thread = { id:randomUUID(), title, updated:Date.now(), provider:"managed" };
    db.prepare("INSERT INTO mobile_threads VALUES (?,?,?,?)").run(owner,thread.id,thread.title,thread.updated);
    return thread;
  }
  function addTask(owner, id, threads, title) {
    const thread = ledger.tx(() => {
      const created = create(owner,title);
      assign.run(owner,created.id,id ?? created.id);
      select.run(owner,id ?? created.id,created.id);
      return created;
    });
    threads.unshift(thread);
    return thread;
  }
  function bot(owner, id, threads, limit, session) {
    const selected = db.prepare("SELECT thread FROM mobile_native_selection WHERE owner=? AND bot=?").get(owner,id);
    const thread = threads.find(t => t.id === selected?.thread) ?? threads[0];
    const root = threads.find(t => t.id === id) ?? thread;
    return { id, threadId:thread.id, name:root.title, title:"", description:"",
      notifications:false, unread:false, color:"cyan", createdAt:root.updated,
      tasks:threads.map(t => ({threadId:t.id,title:t.title,createdAt:t.updated,...t.preferences})),
      modelSelection:{instanceId:thread.provider, model:thread.provider},
      ...threadPage(owner,thread.id,session,limit) };
  }
  function patchTask(owner,task,body) {
    const keys = Object.keys(body);
    if (!keys.length || keys.some(k => !["title","pinned","archivedAt","snoozedUntil"].includes(k))) throw new Fault(400,"invalid_task");
    if ("title" in body && (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length>100)) throw new Fault(400,"invalid_title");
    if ("pinned" in body && typeof body.pinned !== "boolean") throw new Fault(400,"invalid_task");
    for (const key of ["archivedAt","snoozedUntil"]) {
      if (body[key] != null && (!Number.isSafeInteger(body[key]) || body[key]<0)) throw new Fault(400,"invalid_task");
    }
    ledger.tx(() => {
      if ("title" in body) {
        task.title = body.title.trim();
        db.prepare("UPDATE mobile_threads SET title=? WHERE owner=? AND id=?").run(task.title,owner,task.id);
      }
      for (const key of keys.filter(k => k !== "title")) {
        if (body[key] == null) delete task.preferences[key];
        else task.preferences[key] = body[key];
      }
      db.prepare("INSERT INTO mobile_native_task_preferences VALUES (?,?,?) ON CONFLICT(owner,thread) DO UPDATE SET value=excluded.value")
        .run(owner,task.id,JSON.stringify(task.preferences));
    });
  }
  function changed(owner) {
    const streams = activeStreams.get(owner);
    if (streams) streams.revision++;
  }
  async function events(owner, res) {
    if (res.destroyed) return;
    const streams = activeStreams.get(owner) ?? { count:0, revision:0 };
    if (streams.count >= 8) throw new Fault(429, "too_many_connections");
    activeStreams.set(owner,streams);
    streams.count++;
    try {
      let revision = streams.revision;
      const hydrate = () => res.write("data: " + JSON.stringify({kind:"hello",cursor:randomUUID(),resumed:false}) + "\n\n");
      res.writeHead(200, { "content-type":"text/event-stream", "cache-control":"no-store", "x-accel-buffering":"no" });
      hydrate();
      await new Promise(resolve => {
        const poll = setInterval(() => {
          if (res.destroyed || revision === streams.revision) return;
          revision = streams.revision;
          hydrate();
        }, 750);
        const close = () => { clearInterval(poll); clearTimeout(deadline); resolve(); };
        const deadline = setTimeout(close, 45_000);
        res.on("close", close);
      });
    } finally {
      if (!--streams.count) activeStreams.delete(owner);
      if (!res.destroyed) res.end();
    }
  }
  function route({ req,res,json,path,body,owner,session }) {
    const query = new URL(req.url,origin).searchParams;
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(query.get("limit") || query.get("messages"))) || 50));
    const get = req.method === "GET", post = req.method === "POST";
    if (get && path === "/api/events") return { events:events(owner,res) };
    if (get && path === "/api/instances") { json(200,{instances:[]}); return; }
    if (get && path === "/api/search") {
      json(200,{hits:search(owner,query.get("q"),limit,roster(owner))});
      return;
    }
    if (path === "/api/bots" && (post || get)) {
      const groups = roster(owner);
      if (post || !groups.size) {
        const [home,threads] = groups.entries().next().value ?? [null,[]];
        const thread = addTask(owner,home,threads);
        const id = home ?? thread.id;
        groups.set(id,threads);
        if (post) { changed(owner); json(201,{bot:bot(owner,id,threads,limit,session)}); return; }
      }
      json(200,{ bots:Array.from(groups, ([id,threads]) => bot(owner,id,threads,limit,session)), groups:[] });
      return;
    }
    const match = threadRoute.exec(path);
    if (!match) throw new Fault(404,"not_found");
    const [,kind,id,action,taskId] = match;
    if (kind === "threads" && get && !taskId && (action === "messages" || action === "export")) {
      const thread = lists.all(owner).find(t => t.id === id);
      if (!thread) throw new Fault(404,"not_found");
      if (action === "export") return exportTranscript(owner,thread,session,query.get("format") ?? "markdown",res);
      json(200,threadPage(owner,id,session,limit,query.get("before"),query.get("around")));
      return;
    }
    if (kind === "threads" && post && action === "respond" && !taskId) {
      const pending = db.prepare("SELECT * FROM mobile_native_choices WHERE session=? AND thread=? AND id=? AND expires>?")
        .get(session.hash,id,body.requestId,Date.now());
      if (!pending || body.behavior !== "answer") throw new Fault(409,"desktopUnconfirmed");
      const target = JSON.parse(pending.devices).find(d => d.label === body.message)?.id;
      if (!target) throw new Fault(400,"invalid_target");
      if (target === "cancel-wallet") {
        clearChoice(session,id,pending.id);
        changed(owner);
        json(200,{ok:true,threadId:id});
        return;
      }
      if (target === "use-wallet") return {account:owner,thread:id,id:pending.id,save:true,provider:"managed",switchWallet:true,
        prompt:session.open("native-choice:"+pending.id,pending.prompt)};
      return {account:owner,thread:id,id:pending.id,save:true,runtime:"desktop",target,prompt:session.open("native-choice:"+pending.id,pending.prompt)};
    }
    const threads = kind === "bots" && roster(owner).get(id);
    if (!threads) throw new Fault(404,"not_found");
    if (action === "tasks" && taskId && ["DELETE","PATCH"].includes(req.method)) {
      const task = threads.find(t => t.id === taskId);
      if (!task) throw new Fault(404,"not_found");
      if (req.method === "DELETE") {
        if (threads.length < 2 || db.prepare("SELECT 1 FROM mobile_turns WHERE owner=? AND thread=? AND state='running'").get(owner,taskId))
          throw new Fault(409,"turn_in_progress");
        db.prepare("DELETE FROM mobile_threads WHERE owner=? AND id=?").run(owner,taskId);
        threads.splice(threads.indexOf(task),1);
      } else {
        patchTask(owner,task,body);
      }
      changed(owner);
      json(200,{bot:bot(owner,id,threads,limit,session)});
      return;
    }
    if (!post) throw new Fault(404,"not_found");
    if (action === "tasks") {
      if (taskId) {
        if (!threads.some(t => t.id === taskId)) throw new Fault(404,"not_found");
        select.run(owner,id,taskId);
      } else {
        const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0,100) : "StartupBot";
        addTask(owner,id,threads,title);
      }
      changed(owner);
      json(200,{bot:bot(owner,id,threads,limit,session)});
      return;
    }
    if (taskId) throw new Fault(404,"not_found");
    if (action === "read") { json(200,{ok:true}); return; }
    const thread = threads.find(t => t.id === body.threadId);
    if (thread && action === "messages") {
      const previous = db.prepare("SELECT thread,prompt,state FROM mobile_turns WHERE owner=? AND id=?").get(owner,body.sendId ?? "");
      if (previous?.state === "desktop") {
        const receipt = db.prepare("SELECT fingerprint FROM mobile_native_receipts WHERE owner=? AND id=? AND session=?").get(owner,body.sendId,session.hash);
        if (previous.thread !== thread.id || typeof body.text !== "string" || receipt?.fingerprint !== session.draftFingerprint(body.sendId,body.text)) throw new Fault(409,"request_exists");
        json(200,{ok:true,threadId:thread.id}); return;
      }
      if (previous?.thread === thread.id && previous.prompt === body.text && ["running","complete","limited","computer_needed"].includes(previous.state)) {
        json(200,{ok:true,threadId:thread.id}); return;
      }
      return { account:owner, thread:thread.id, id:body.sendId, prompt:body.text, save:true, provider:thread.provider };
    }
    throw new Fault(404, "not_found");
  }
  function allowsDrafts(session) {
    return Boolean(db.prepare("SELECT 1 FROM mobile_native_draft_grants WHERE session=?").get(session));
  }
  function choose(session, body, devices, title) {
    writeChoice(session,body,devices.map(d => ({id:d.id,label:d.name+" · "+d.code})),title,"desktopChoose");
  }
  function offerWallet(session,body,messages) {
    writeChoice(session,body,[{id:"use-wallet",label:messages.useWallet},{id:"cancel-wallet",label:messages.cancel}],messages.provider_disconnected,"provider_disconnected");
  }
  function clearChoice(session,thread,id) {
    db.prepare("DELETE FROM mobile_native_choices WHERE session=? AND thread=? AND id=?").run(session.hash,thread,id);
  }
  function writeChoice(session,body,choices,title,pendingError) {
    db.prepare("DELETE FROM mobile_native_choices WHERE expires<=?").run(Date.now());
    const previous = db.prepare("SELECT id,prompt FROM mobile_native_choices WHERE session=? AND thread=?").get(session.hash,body.thread);
    if (previous && (previous.id !== body.id || session.open("native-choice:"+previous.id,previous.prompt) !== body.prompt)) throw new Fault(409,pendingError);
    db.prepare("INSERT OR REPLACE INTO mobile_native_choices VALUES (?,?,?,?,?,?,?,?)")
      .run(session.hash,session.owner,body.thread,body.id,session.seal("native-choice:"+body.id,body.prompt),JSON.stringify(choices),title,Date.now()+120000);
    changed(session.owner);
  }
  function received(owner, body, messages, session) {
    ledger.tx(() => {
      db.prepare("DELETE FROM mobile_native_choices WHERE session=? AND thread=? AND id=?").run(session.hash,body.thread,body.id);
      // Keep desktop prompts out of the cloud transcript and future model context.
      db.prepare("INSERT OR IGNORE INTO mobile_turns(owner,thread,id,prompt,answer,state,created) VALUES (?,?,?,?,?,'desktop',?)")
        .run(owner,body.thread,body.id,messages.desktop,messages.desktopReceived,Date.now());
      db.prepare("INSERT OR IGNORE INTO mobile_native_receipts VALUES (?,?,?,?)")
        .run(owner,body.id,session.hash,session.draftFingerprint(body.id,body.prompt));
    });
    changed(owner);
  }
  return { environment, route, changed, allowsDrafts, choose, received, offerWallet, clearChoice };
}
