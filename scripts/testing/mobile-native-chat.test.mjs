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
  const mutate = (id,method,body) => fetch(fixture.url+url+"/"+id,{method,headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:body && JSON.stringify(body)});
  expect((await mutate(next.threadId,"PATCH",{title:"Updated"})).status).toBe(200);
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
  expect((await request(token,"/api/bots/"+bot.id+"/messages",input)).status).toBe(200);
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
  expect(JSON.stringify(await read(token))).not.toContain(input.text);
  expect(fixture.generations).toHaveLength(0);
});
