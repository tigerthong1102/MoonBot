import { Fault } from "./ledger.mjs";

export function nativeHistory(db) {
  const latestTurn = db.prepare("SELECT id,created,answer<>'' AS answered FROM mobile_turns WHERE owner=? AND thread=? ORDER BY created DESC,id DESC LIMIT 1");
  const cursorTurn = db.prepare("SELECT id,created,answer<>'' AS answered FROM mobile_turns WHERE owner=? AND thread=? AND id=?");
  const precedingTurns = db.prepare(`SELECT id,prompt,answer,created FROM mobile_turns WHERE owner=? AND thread=? AND (created,id)<=(?,?)
    ORDER BY created DESC,id DESC LIMIT ?`);
  function threadPage(owner, thread, session, limit, before, around) {
    const latest = latestTurn.get(owner,thread);
    const choice = db.prepare("SELECT id,devices,title,expires FROM mobile_native_choices WHERE session=? AND thread=? AND expires>?").get(session.hash,thread,Date.now());
    const choiceId = choice && choice.id+"-choice";
    const activeLeafId = choiceId ?? (latest?.answered ? latest.id+"-answer" : latest?.id);
    let cursor = latest;
    const anchor = before || around;
    if (anchor && anchor !== choiceId) {
      cursor = cursorTurn.get(owner,thread,anchor.replace(/-answer$/, ""));
      if (!cursor || (anchor.endsWith("-answer") && !cursor.answered)) throw new Fault(404, "message_not_found");
    }
    const turns = cursor ? precedingTurns.all(owner,thread,cursor.created,cursor.id,limit+2).reverse() : [];
    let parentId;
    const messages = [];
    for (const turn of turns) {
      const user = { id:turn.id, role:"user", kind:"text", at:turn.created, text:turn.prompt, parentId };
      messages.push(user);
      parentId = user.id;
      if (turn.answer) {
        parentId = turn.id + "-answer";
        messages.push({ id:parentId, parentId:user.id, role:"bot", kind:"text", text:turn.answer, at:turn.created });
      }
    }
    if (choice && (!anchor || anchor === choiceId)) messages.push({ id:choiceId, parentId, role:"bot",kind:"options",at:choice.expires-120000,
      card:{title:choice.title,subtitle:"",requestId:choice.id,options:JSON.parse(choice.devices).map(d => d.label)} });
    const position = anchor ? messages.findIndex(message => message.id === anchor) : messages.length;
    if (position < 0) throw new Fault(404, "message_not_found");
    const end = around && !before ? position + 1 : position;
    const start = Math.max(0, end - limit);
    return { messages:messages.slice(start,end), activeLeafId, hasMore:start > 0 };
  }
  db.exec("CREATE INDEX IF NOT EXISTS mobile_native_search_order ON mobile_turns(owner,created,id)");
  const searchRows = db.prepare(`SELECT id,thread,prompt,answer,created FROM mobile_turns
    WHERE owner=? AND (created,id)<(?,?) ORDER BY created DESC,id DESC LIMIT 16`);
  function search(owner, query, limit, groups) {
    const term = query?.trim() ?? "";
    if (term.length < 2) return [];
    if (term.length > 256) throw new Fault(400,"invalid_search");
    const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"iu");
    const threads = new Map();
    for (const [botId,tasks] of groups) {
      const name = (tasks.find(t => t.id === botId) ?? tasks[0]).title;
      for (const task of tasks) threads.set(task.id,{botId,name,task:task.title});
    }
    const hits = [];
    let created = Number.MAX_SAFE_INTEGER, id = "";
    while (hits.length < limit) {
      const rows = searchRows.all(owner,created,id);
      if (!rows.length) break;
      for (const row of rows) {
        for (const [role,text,messageId] of [["bot",row.answer,row.id+"-answer"],["user",row.prompt,row.id]]) {
          const match = pattern.exec(text);
          if (!match) continue;
          const start = Math.max(0,match.index-60);
          const end = Math.min(text.length,match.index+match[0].length+90);
          hits.push({...threads.get(row.thread),threadId:row.thread,messageId,at:row.created,role,kind:"text",
            snippet:text.slice(start,end),matchStart:match.index-start,matchLength:match[0].length,onActivePath:true});
          if (hits.length === limit) return hits;
        }
      }
      ({created,id} = rows.at(-1));
    }
    return hits;
  }
  return { threadPage, search };
}
