import { randomUUID } from "node:crypto";
import { Fault } from "./ledger.mjs";

export function nativePath(path) {
  return path === "/.well-known/openmausbot/environment" || path?.startsWith("/api/");
}

const threadRoute = /^\/api\/(bots|threads)\/([\da-fA-F-]{36})\/(read|messages|tasks)(?:\/([\da-fA-F-]{36}))?$/;

export function nativeChat(ledger, lists, origin) {
  const { db } = ledger;
  const environment = { label:"StartupBot", platform:"cloud", environmentId:"startupbot-mobile:" + origin };
  const activeStreams = new Map();
  db.exec(`
    CREATE TABLE IF NOT EXISTS mobile_native_task_groups(owner TEXT NOT NULL,thread TEXT NOT NULL,bot TEXT NOT NULL,
      PRIMARY KEY(owner,thread), FOREIGN KEY(owner,thread) REFERENCES mobile_threads(owner,id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS mobile_native_selection(owner TEXT NOT NULL,bot TEXT NOT NULL,thread TEXT NOT NULL,
      PRIMARY KEY(owner,bot), FOREIGN KEY(owner,thread) REFERENCES mobile_threads(owner,id) ON DELETE CASCADE);
  `);
  function roster(owner) {
    const groups = new Map();
    const parent = new Map(db.prepare("SELECT thread,bot FROM mobile_native_task_groups WHERE owner=?").all(owner).map(row => [row.thread,row.bot]));
    for (const thread of lists.all(owner)) {
      const id = parent.get(thread.id) ?? thread.id;
      if (!groups.has(id)) groups.set(id,[]);
      groups.get(id).push(thread);
    }
    return groups;
  }
  const select = db.prepare("INSERT INTO mobile_native_selection VALUES (?,?,?) ON CONFLICT(owner,bot) DO UPDATE SET thread=excluded.thread");
  const turns = db.prepare("SELECT id,prompt,answer,state,created FROM mobile_turns WHERE owner=? AND thread=? ORDER BY created,id LIMIT 80");
  function transcript(owner, thread) {
    let parentId;
    const messages = [];
    for (const turn of turns.all(owner, thread)) {
      const user = { id:turn.id, role:"user", kind:"text", at:turn.created, text:turn.prompt, parentId };
      messages.push(user);
      parentId = user.id;
      if (turn.answer) {
        parentId = turn.id + "-answer";
        messages.push({ id:parentId, parentId:user.id, role:"bot", kind:"text", text:turn.answer, at:turn.created });
      }
    }
    return messages;
  }
  function page(messages, limit, before) {
    const end = before ? messages.findIndex(message => message.id === before) : messages.length;
    if (end < 0) throw new Fault(404, "message_not_found");
    const start = Math.max(0, end - limit);
    return { messages:messages.slice(start,end), activeLeafId:messages.at(-1)?.id, hasMore:start > 0 };
  }
  function create(owner, title = "StartupBot") {
    if (lists.all(owner).length >= 50) throw new Fault(409, "history_full");
    const thread = { id:randomUUID(), title, updated:Date.now(), provider:"managed" };
    db.prepare("INSERT INTO mobile_threads VALUES (?,?,?,?)").run(owner,thread.id,thread.title,thread.updated);
    return thread;
  }
  function bot(owner, id, threads, limit) {
    const selected = db.prepare("SELECT thread FROM mobile_native_selection WHERE owner=? AND bot=?").get(owner,id);
    const thread = threads.find(t => t.id === selected?.thread) ?? threads[0];
    const root = threads.find(t => t.id === id) ?? thread;
    return { id, threadId:thread.id, name:root.title, title:"", description:"",
      notifications:false, unread:false, color:"cyan", createdAt:root.updated,
      tasks:threads.map(t => ({threadId:t.id,title:t.title,createdAt:t.updated})),
      modelSelection:{instanceId:thread.provider, model:thread.provider},
      ...page(transcript(owner,thread.id),limit) };
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
  function route({ req,res,json,path,body,owner }) {
    const query = new URL(req.url,origin).searchParams;
    const limit = Math.min(100, Math.max(1, Number(query.get("limit") || query.get("messages")) || 50));
    const get = req.method === "GET", post = req.method === "POST";
    if (get && path === "/api/events") return { events:events(owner,res) };
    if (get && path === "/api/instances") { json(200,{instances:[]}); return; }
    if (path === "/api/bots" && (post || get)) {
      const groups = roster(owner);
      if (post || !groups.size) {
        const thread = create(owner);
        groups.set(thread.id,[thread]);
        if (post) { changed(owner); json(201,{bot:bot(owner,thread.id,[thread],limit)}); return; }
      }
      json(200,{ bots:Array.from(groups, ([id,threads]) => bot(owner,id,threads,limit)), groups:[] });
      return;
    }
    const match = threadRoute.exec(path);
    if (!match) throw new Fault(404,"not_found");
    const [,kind,id,action,taskId] = match;
    if (kind === "threads" && get && action === "messages" && !taskId) {
      if (!lists.all(owner).some(t => t.id === id)) throw new Fault(404,"not_found");
      json(200,page(transcript(owner,id),limit,query.get("before")));
      return;
    }
    const threads = kind === "bots" && roster(owner).get(id);
    if (!threads || !post) throw new Fault(404,"not_found");
    if (action === "tasks") {
      const selected = taskId ? threads.find(t => t.id === taskId) : ledger.tx(() => {
        const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0,100) : "StartupBot";
        const thread = create(owner,title);
        db.prepare("INSERT INTO mobile_native_task_groups VALUES (?,?,?)").run(owner,thread.id,id);
        threads.unshift(thread);
        return thread;
      });
      if (!selected) throw new Fault(404,"not_found");
      select.run(owner,id,selected.id);
      changed(owner);
      json(200,{bot:bot(owner,id,threads,limit)});
      return;
    }
    if (taskId) throw new Fault(404,"not_found");
    if (action === "read") { json(200,{ok:true}); return; }
    const thread = threads.find(t => t.id === body.threadId);
    if (thread && action === "messages") {
      const previous = db.prepare("SELECT thread,prompt,state FROM mobile_turns WHERE owner=? AND id=?").get(owner,body.sendId ?? "");
      if (previous?.thread === thread.id && previous.prompt === body.text && ["running","complete","limited"].includes(previous.state)) {
        json(200,{ok:true,threadId:thread.id}); return;
      }
      return { account:owner, thread:thread.id, id:body.sendId, prompt:body.text, save:true, provider:thread.provider };
    }
    throw new Fault(404, "not_found");
  }
  function allowsDrafts(session) {
    return Boolean(db.prepare("SELECT 1 FROM mobile_native_draft_grants WHERE session=?").get(session));
  }
  function received(owner, body, messages) {
    // Keep desktop prompts out of the cloud transcript and future model context.
    db.prepare("INSERT OR IGNORE INTO mobile_turns(owner,thread,id,prompt,answer,state,created) VALUES (?,?,?,?,?,'desktop',?)")
      .run(owner,body.thread,body.id,messages.desktop,messages.desktopReceived,Date.now());
    changed(owner);
  }
  return { environment, route, changed, allowsDrafts, received };
}
