import { randomUUID } from "node:crypto";
import { Fault } from "./ledger.mjs";

export function nativePath(path) {
  return path === "/.well-known/openmausbot/environment" || path?.startsWith("/api/");
}

const threadRoute = /^\/api\/(bots|threads)\/([\da-fA-F-]{36})\/(read|messages)$/;

export function nativeChat(ledger, lists, origin) {
  const { db } = ledger;
  const environment = { label:"StartupBot", platform:"cloud", environmentId:"startupbot-mobile:" + origin };
  const listeners = new Map();
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
  function create(owner) {
    if (lists.all(owner).length >= 50) throw new Fault(409, "history_full");
    const thread = { id:randomUUID(), title:"StartupBot", updated:Date.now(), provider:"managed" };
    db.prepare("INSERT INTO mobile_threads VALUES (?,?,?,?)").run(owner,thread.id,thread.title,thread.updated);
    return thread;
  }
  function bot(owner, thread, limit) {
    return { id:thread.id, threadId:thread.id, name:thread.title, title:"", description:"",
      notifications:false, unread:false, color:"cyan", createdAt:thread.updated,
      modelSelection:{instanceId:thread.provider, model:thread.provider},
      ...page(transcript(owner,thread.id),limit) };
  }
  function changed(owner) {
    for (const notify of listeners.get(owner) ?? []) notify();
  }
  async function events(owner, res) {
    if (res.destroyed) return;
    const group = listeners.get(owner) ?? new Set();
    if (group.size >= 8) throw new Fault(429, "too_many_connections");
    res.writeHead(200, { "content-type":"text/event-stream", "cache-control":"no-store", "x-accel-buffering":"no" });
    const notify = () => {
      if (!res.destroyed) res.write("data: " + JSON.stringify({kind:"hello",cursor:randomUUID(),resumed:false}) + "\n\n");
    };
    listeners.set(owner,group);
    group.add(notify);
    try {
      notify();
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 45_000);
        res.on("close", () => { clearTimeout(timer); resolve(); });
      });
    } finally {
      group.delete(notify);
      if (!group.size) listeners.delete(owner);
      if (!res.destroyed) res.end();
    }
  }
  function route({ req,res,json,path,body,owner,connected }) {
    const query = new URL(req.url,origin).searchParams;
    const limit = Math.min(100, Math.max(1, Number(query.get("limit") || query.get("messages")) || 50));
    const get = req.method === "GET", post = req.method === "POST";
    if (get && path === "/api/events") return { events:events(owner,res) };
    if (get && path === "/api/instances") { json(200,{instances:[]}); return; }
    if (path === "/api/bots" && (post || get)) {
      let threads = lists.all(owner);
      if (post || !threads.length) {
        const thread = create(owner);
        if (post) { changed(owner); json(201,{bot:bot(owner,thread,limit)}); return; }
        threads = [thread];
      }
      json(200,{ bots:threads.map(thread => bot(owner,thread,limit)), groups:[] });
      return;
    }
    const match = threadRoute.exec(path);
    const thread = match && lists.all(owner).find(row => row.id === match[2]);
    if (!thread) throw new Fault(404, "not_found");
    if (match[1] === "threads" && get && match[3] === "messages") {
      json(200,page(transcript(owner,thread.id),limit,query.get("before")));
      return;
    }
    if (match[1] === "bots" && post && match[3] === "read") { json(200,{ok:true}); return; }
    if (match[1] === "bots" && post && match[3] === "messages" && body.threadId === thread.id) {
      const previous = db.prepare("SELECT thread,prompt,state FROM mobile_turns WHERE owner=? AND id=?").get(owner,body.sendId ?? "");
      if (previous?.thread === thread.id && previous.prompt === body.text && ["complete","limited"].includes(previous.state)) {
        json(200,{ok:true,threadId:thread.id}); return;
      }
      return { account:owner, thread:thread.id, id:body.sendId, prompt:body.text, save:true, provider:thread.provider };
    }
    throw new Fault(404, "not_found");
  }
  return { environment, route, changed };
}
