import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { startMobileFixture } from "./mobile-chat-fixture.mjs";

let fixture;
beforeEach(async () => { fixture = await startMobileFixture(); });
afterEach(async () => { await fixture.close(); });

async function signIn(name) {
  const email = name + "@example.test";
  await fixture.call("/code", null, { email });
  const response = await fixture.call("/login", null, { client:"companion", email, otp:"12345678" });
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
