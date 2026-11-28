import { draftKeys, unsealDraft } from "../../electron/mobile-desktop-envelope.mjs";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { startMobileFixture } from "./mobile-chat-fixture.mjs";

let fixture;
beforeEach(async () => { fixture = await startMobileFixture(); });
afterEach(async () => { await fixture.close(); });

async function signIn(name, desktopDrafts = "deny") {
  const email = name + "@example.test";
  await fixture.call("/code", null, { email });
  const response = await fixture.call("/login", null, { client:"companion", desktopDrafts, email, otp:"12345678" });
  expect(response.headers.get("set-cookie")).toBeNull();
  const { token, environment } = await response.json();
  expect(environment).toEqual(await (await fetch(fixture.url + "/.well-known/openmausbot/environment")).json());
  return token;
}
function request(token, path, body) {
  return fetch(fixture.url + path, { method:body ? "POST" : "GET",
    headers:{ authorization:"Bearer " + token, "content-type":"application/json" },
    body:body && JSON.stringify(body) });
}

it("continues a web OpenRouter conversation natively only after its owner selects the wallet", async () => {
  fixture.settings.openRouterOAuth = true;
  const web = await fixture.login("alice"), account = "alice", thread = crypto.randomUUID();
  const post = (path,body) => fixture.call(path,web,{account,...body});
  const start = new URL((await (await post("/provider/start",{})).json()).url);
  expect((await post("/provider/complete",{state:start.searchParams.get("state"),code:"fixture-code"})).status).toBe(200);
  const initial = await post("/send",{thread,id:crypto.randomUUID(),prompt:"Translate a greeting",provider:"openrouter",save:true});
  expect(initial.status).toBe(200);await initial.text();
  fixture.grant(account);
  const token = await signIn(account), other = await signIn(account);
  const bot = (await (await request(token,"/api/bots")).json()).bots.find(b=>b.threadId===thread);
  const send = {threadId:thread,sendId:crypto.randomUUID(),text:"And in French?"};
  const route = "/api/bots/"+bot.id+"/messages", respond="/api/threads/"+thread+"/respond";
  const currentCard = async () => (await (await request(token,"/api/threads/"+thread+"/messages")).json()).messages.at(-1).card;
  expect((await request(token,route,send)).status).toBe(409);
  let card=await currentCard();
  const choice=label=>({requestId:card.requestId,behavior:"answer",message:label});
  expect((await request(other,respond,choice(card.options[0]))).status).toBe(409);
  expect((await request(token,respond,choice(card.options[1]))).status).toBe(200);
  expect((await (await fixture.call("/threads",web)).json()).threads[0].provider).toBe("openrouter");
  expect((await request(token,route,send)).status).toBe(409);
  card=await currentCard();
  expect((await request(token,respond,choice(card.options[0]))).status).toBe(200);
  expect((await request(token,route,send)).status).toBe(200);
  expect((await (await fixture.call("/threads",web)).json()).threads[0].provider).toBe("managed");
  expect((await (await post("/history",{thread})).json()).turns.map(t=>t.prompt)).toEqual(["Translate a greeting",send.text]);
});

it("hydrates the original companion roster, sends without a paired computer, and restores the reply on another phone", async () => {
  const token = await signIn("alice");
  fixture.grant("alice");
  const fleet = await (await request(token,"/api/bots")).json();
  const bot = fleet.bots[0];
  expect(bot.messages).toEqual([]);
  const events = await request(token,"/api/events");
  const reader = events.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    expect((await reader.read()).value).toContain('"resumed":false');
    const send = { text:"Hello", threadId:bot.threadId, sendId:randomUUID() };
    const route = "/api/bots/" + bot.id + "/messages";
    expect((await request(token,route,send)).status).toBe(200);
    expect((await reader.read()).value).toContain('"kind":"hello"');
    expect((await request(token,route,send)).status).toBe(200);
    expect(fixture.generations).toHaveLength(1);
    const secondPhone = await signIn("alice");
    const restored = await (await request(secondPhone,"/api/bots")).json();
    expect(restored.bots[0].messages.map(m => [m.role,m.text])).toEqual([["user","Hello"],["bot","Xin chào"]]);
    const bob = await signIn("bob");
    expect((await request(bob,route,send)).status).toBe(404);
    expect((await request(bob,"/api/threads/" + bot.threadId + "/messages")).status).toBe(404);
    expect((await request(token,route,{...send,sendId:randomUUID(),text:"Mở MISA"})).status).toBe(409);
    expect(fixture.generations).toHaveLength(1);
    expect((await request(token,"/api/auth/logout",{})).status).toBe(200);
    expect((await request(token,"/api/bots")).status).toBe(401);
    expect((await request(secondPhone,"/api/bots")).status).toBe(200);
  } finally { await reader.cancel(); }
});

it("keeps browser cookies and native credentials on separate transports", async () => {
  const cookie = await fixture.login("alice");
  const handle = cookie.split("=")[1];
  expect((await request("sb_mobile_"+handle,"/api/bots")).status).toBe(401);
  const token = await signIn("alice");
  expect((await fixture.call("/threads","__Host-startupbot-mobile="+token.slice(10))).status).toBe(401);
  expect((await fetch(fixture.url + "/api/bots",{headers:{cookie}})).status).toBe(401);
});

it("creates and switches tasks from the original thread picker without mixing history", async () => {
  const token = await signIn("alice");
  const { bots:[first] } = await (await request(token,"/api/bots")).json();
  const route = "/api/bots/" + first.id + "/tasks";
  const { bot:next } = await (await request(token,route,{ title:"Notes" })).json();
  expect(next.id).toBe(first.id);
  expect(next.threadId).not.toBe(first.threadId);
  expect(next.tasks).toContainEqual(expect.objectContaining({title:"Notes",threadId:next.threadId}));
  expect((await (await request(token,"/api/bots")).json()).bots[0].threadId).toBe(next.threadId);
  const { bot:previous } = await (await request(token,route+"/"+first.threadId,{})).json();
  expect(previous.threadId).toBe(first.threadId);
  expect((await request(await signIn("bob"),route,{})).status).toBe(404);
});

it("finishes an accepted native turn after the phone disconnects without charging its retry twice", async () => {
  fixture.behavior.delay = 400;
  const token = await signIn("alice");
  fixture.grant("alice");
  const { bots:[bot] } = await (await request(token,"/api/bots")).json();
  const path = "/api/bots/" + bot.id + "/messages";
  const body = { threadId:bot.threadId, text:"Hello", sendId:randomUUID() };
  const controller = new AbortController();
  const sending = fetch(fixture.url+path,{method:"POST",signal:controller.signal,
    headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify(body)}).catch(() => {});
  await expect.poll(() => fixture.generations.length).toBe(1);
  controller.abort();
  await sending;
  expect((await request(token,path,body)).status).toBe(200);
  await expect.poll(async () => (await (await request(token,"/api/bots")).json()).bots[0].messages.at(-1)?.role).toBe("bot");
  expect(fixture.generations).toHaveLength(1);
});

it("deletes and renames tasks only in their owning native roster", async () => {
  const token = await signIn("alice");
  const { bots:[root] } = await (await request(token,"/api/bots")).json();
  const url = "/api/bots/"+root.id+"/tasks";
  const {bot:next} = await (await request(token,url,{title:"Second"})).json();
  const mutate = (id,method,body) => {
    const headers = {authorization:"Bearer "+token,"content-type":"application/json"};
    const options = body ? {method:"PATCH",headers,body:JSON.stringify(body)} : {method,headers};
    return fetch(fixture.url+url+"/"+id,options);
  };
  expect((await mutate(next.threadId,"PATCH",{title:"Updated"})).status).toBe(200);
  const ts = Date.now()+60000;
  expect((await mutate(next.threadId,"PATCH",{pinned:true,archivedAt:0,snoozedUntil:ts})).status).toBe(200);
  const {bots:[persisted]} = await (await request(token,"/api/bots")).json();
  expect(persisted.tasks.find(t=>t.threadId===next.threadId)).toMatchObject({pinned:true,archivedAt:0,snoozedUntil:ts});
  expect((await mutate(next.threadId,"PATCH",{archivedAt:null})).status).toBe(200);
  const {bot:remaining} = await (await mutate(root.threadId,"DELETE")).json();
  expect(remaining.id).toBe(root.id);
  expect(remaining.tasks.map(t=>t.title)).toEqual(["Updated"]);
  expect((await mutate(next.threadId,"DELETE")).status).toBe(409);
});

it("uses the existing native answer card to hand a private draft to the selected desktop", async () => {
  fixture.settings.mobileDesktopHandoff = true;
  const token = await signIn("alice","allow");
  const {bots:[bot]} = await (await request(token,"/api/bots")).json();
  const devices = ["Office","Home"].map(name=>({id:randomUUID(),name,code:randomUUID().slice(0,8)}));
  const listener = randomUUID(), keys = await draftKeys();
  const input = {threadId:bot.threadId,sendId:randomUUID(),text:"Mở MISA trên máy tính"};
  let delivered;
  fixture.behavior.desktopDraft = async (path,body) => {
    if(path.endsWith("/targets")) return body.target===devices[1].id ? {state:"ready",id:devices[1].id,listener,publicKey:keys.publicKey} : {state:"choose",devices};
    expect(body.installation).toBe(devices[1].id);
    delivered = await unsealDraft(body.envelope,keys.privateKey,body.id,listener);
    return {state:"received"};
  };
  expect((await request(token,"/api/bots/"+bot.id+"/messages",input)).status).toBe(409);
  const read = async bearer => (await (await request(bearer,"/api/threads/"+bot.threadId+"/messages")).json()).messages;
  const card = (await read(token)).at(-1).card;
  expect(card.options[1]).toContain("Home");
  const response = "/api/threads/"+bot.threadId+"/respond";
  const answer = {requestId:card.requestId,behavior:"answer",message:card.options[1]};
  const other = await signIn("alice","allow");
  expect(await read(other)).toHaveLength(0);
  expect((await request(other,response,answer)).status).toBe(409);
  expect(delivered).toBeUndefined();
  expect((await request(token,response,answer)).status).toBe(200);
  expect(delivered).toBe(input.text);
  fixture.behavior.desktopDraft = () => { throw new Error("Delivered drafts must not be offered a second time"); };
  expect((await request(token,"/api/bots/"+bot.id+"/messages",input)).status).toBe(200);
  expect(JSON.stringify(await read(token))).not.toContain(input.text);
  expect(fixture.generations).toHaveLength(0);
});

it("shows the newest desktop receipt and pages through every earlier message in order", async () => {
  const token = await signIn("alice");
  const {bots:[bot]} = await (await request(token,"/api/bots")).json();
  const insert = fixture.ledger.db.prepare("INSERT INTO mobile_turns(owner,thread,id,prompt,answer,state,created) VALUES (?,?,?,?,?,?,?)");
  const ids = [];
  fixture.ledger.tx(() => {
    for (let index = 0; index < 85; index++) {
      const id = String(index).padStart(3,"0");
      insert.run("alice",bot.threadId,id,"Desktop","Received","desktop",Math.floor(index/5));
      ids.push(id,id+"-answer");
    }
  });
  const {bots:[restored]} = await (await request(token,"/api/bots?messages=3")).json();
  expect(restored.messages.map(m => m.id)).toEqual(ids.slice(-3));
  const path = "/api/threads/"+bot.threadId+"/messages?limit=9";
  let before = "";
  let remaining = ids.length;
  while (remaining) {
    const page = await (await request(token,path+before)).json();
    const first = Math.max(0,remaining-9);
    expect(page.messages.map(m => m.id)).toEqual(ids.slice(first,remaining));
    expect(page.messages[0].parentId).toBe(ids[first-1]);
    expect(page.activeLeafId).toBe(ids.at(-1));
    expect(page.hasMore).toBe(first > 0);
    before = "&before="+page.messages[0].id;
    remaining = first;
  }
  expect((await request(token,path+"&before=missing")).status).toBe(404);
});

it("can reclaim space from a full account with 50 legacy standalone conversations in the native picker", async () => {
  const token = await signIn("alice");
  const insert = fixture.ledger.db.prepare("INSERT INTO mobile_threads VALUES ('alice',?,?,?)");
  for (let i = 0; i < 50; i++) insert.run(randomUUID(),"Legacy "+i,i);
  expect((await request(token,"/api/bots",{})).status).toBe(409);
  const {bots} = await (await request(token,"/api/bots")).json();
  expect(bots).toHaveLength(1);
  expect(bots[0].tasks).toHaveLength(50);
  const route = "/api/bots/"+bots[0].id+"/tasks/"+bots[0].tasks[0].threadId;
  const deleted = await fetch(fixture.url+route,{method:"DELETE",headers:{authorization:"Bearer "+token}});
  expect(deleted.status).toBe(200);
  const {bot} = await (await request(token,"/api/bots",{})).json();
  expect(bot.id).toBe(bots[0].id);
  expect(bot.tasks).toHaveLength(50);
  expect(bot.threadId).not.toBe(bots[0].tasks[0].threadId);
});

it("finds Vietnamese text and literal punctuation only in the owner's saved history and opens old results", async () => {
  const token = await signIn("alice");
  const {bots:[bot]} = await (await request(token,"/api/bots")).json();
  const insert = fixture.ledger.db.prepare("INSERT INTO mobile_turns(owner,thread,id,prompt,answer,state,created) VALUES (?,?,?,?,?,'complete',?)");
  const target = randomUUID();
  insert.run("alice",bot.threadId,target,"Viết 📗 BÁO CÁO (*)","Đã viết báo cáo (*)",0);
  for (let i=1; i<=60; i++) insert.run("alice",bot.threadId,randomUUID(),"Next","Done",i);
  const search = "/api/search?q="+encodeURIComponent("báo cáo (*)");
  const {hits} = await (await request(token,search)).json();
  expect(hits.map(h=>h.messageId)).toEqual([target+"-answer",target]);
  for (const hit of hits) {
    expect(hit).toMatchObject({botId:bot.id,threadId:bot.threadId,onActivePath:true,kind:"text"});
    expect(hit.snippet.slice(hit.matchStart,hit.matchStart+hit.matchLength).toLowerCase()).toBe("báo cáo (*)");
    const page = await (await request(token,"/api/threads/"+bot.threadId+"/messages?around="+hit.messageId)).json();
    expect(page.messages.at(-1).id).toBe(hit.messageId);
    expect(page.activeLeafId).not.toBe(hit.messageId);
  }
  expect((await (await request(token,search+"&limit=1")).json()).hits).toHaveLength(1);
  expect((await (await request(await signIn("bob"),search)).json()).hits).toEqual([]);
});

it("exports a whole private mobile conversation in the formats the original share sheets consume", async () => {
  const alice = await signIn("alice");
  const {bots:[bot]} = await (await request(alice,"/api/bots")).json();
  const insert = fixture.ledger.db.prepare("INSERT INTO mobile_turns(owner,thread,id,prompt,answer,state,created) VALUES (?,?,?,?,?,'complete',?)");
  for (let i=0; i<54; i++) insert.run("alice",bot.threadId,randomUUID(),"Hỏi "+i,"Trả lời "+i,i);
  const route = "/api/threads/"+bot.threadId+"/export";
  const json = await request(alice,route+"?format=json");
  expect(json.headers.get("content-disposition")).toBe('attachment; filename="StartupBot.json"');
  const exported = await json.json();
  expect(exported.threadId).toBe(bot.threadId);
  expect(exported.messages).toHaveLength(108);
  expect(exported.messages[0].text).toBe("Hỏi 0");
  expect(exported.messages.at(-1).text).toBe("Trả lời 53");
  const markdown = await request(alice,route+"?format=markdown");
  expect(markdown.headers.get("content-type")).toContain("text/markdown");
  expect(await markdown.text()).toContain("**StartupBot:**\n\nTrả lời 53");
  expect((await request(alice,route+"?format=zip")).status).toBe(400);
  expect((await request(await signIn("bob"),route)).status).toBe(404);
});
