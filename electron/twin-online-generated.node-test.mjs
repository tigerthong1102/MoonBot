import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHash, generateKeyPairSync, randomUUID, verify } from "node:crypto";
import { createOnlineGenerated } from "./twin-online-generated.mjs";
import { generatedGrantMessage, generatedPostMessage, generatedRenewalMessage } from "./twin-generated-message.mjs";
import { generatedComposerNotice, prepareInboxPost } from "../cloudflare/control-plane/inbox/public/twin-generated-notice.js";

function fixture(t, overrides = {}) {
  const provider = { key: randomUUID(), name: "Fixture", model: "fixture", destination: "http://127.0.0.1:19100" };
  const origin = "https://inbox.example.test", now = 100000;
  const pair = generateKeyPairSync("ed25519");
  const key = { origin, key: pair.privateKey, id: randomUUID(), owner: randomUUID(), twin: randomUUID(), revision: 1, expires: now + 90000, deadline: 90000 };
  const room = { id: randomUUID(), ref: randomUUID(), title:"Fixture", kind:"group" };
  const job = { source:4, room:room.id, nonce:randomUUID(), expires:now + 45000 };
  const question = "Is the fixture open?", inputHash = createHash("sha256").update(question).digest("hex");
  let grant, generations = 0, elapsed = 0, central = true, proposal;
  const authorizedUntil = now + 7 * 86400000;
  const records = new Map(), calls = [];
  const inbox = async (path, data) => {
    if (path === "me") return { id:key.owner, generatedAnswer:true };
    if (path.endsWith("?rooms=1")) return { owner:key.owner, rooms:overrides.rooms ?? [room] };
    if (path === "twin-generated" && !data) return { owner:key.owner, grant:central && grant ? {id:grant.id,enabled:true} : null };
    calls.push(data);
    switch (data.action) {
      case "offer":
        grant = {...data, twin:key.twin, revision:key.revision, origin};
        assert(verify(null, Buffer.from(generatedGrantMessage(grant)), pair.publicKey, Buffer.from(data.signature, "hex")));
        return {id:data.id,offered:true};
      case "lease": {
        await overrides.beforeLease?.();
        proposal = { id: grant.id, nonce: randomUUID(), now:now+elapsed, expires:now+elapsed+600000, authorizedUntil, enabled:true };
        return proposal;
      }
      case "renew":
        assert(verify(null,Buffer.from(generatedRenewalMessage({...grant,nonce:data.nonce,expires:data.expires})),pair.publicKey,Buffer.from(data.signature,"hex")));
        assert.equal(data.nonce,proposal.nonce);
        return {id:grant.id,now:now+elapsed,expires:data.expires,authorizedUntil,...overrides.renewReceipt};
      case "claim":
        if (grant.dailyLimit === undefined) return {now,challenge:job};
        Object.assign(job,{ nonce:randomUUID(), kind:room.kind, expires:now+elapsed+45000 });
        return {now:now+elapsed,challenge:central ? job : null,enabled:central,revoked:!central};
      case "dispatch": return {question,inputHash,...overrides.dispatch};
      case "check": return {active:central};
      case "finish":
        assert(verify(null, Buffer.from(generatedPostMessage({...grant,...job,inputHash,answer:data.answer})),
          pair.publicKey, Buffer.from(data.signature,"hex")));
        return {published:true,source:job.source};
      case "revoke": return {id:data.id,revoked:true};
      default: throw Error("unexpected action");
    }
  };
  const service = createOnlineGenerated({state:()=>key,check:async()=>{ if(elapsed>=key.deadline) throw Error("expired original pairing"); },checkOnline:async()=>{},profile:async()=>({twin:{id:key.twin,revision:key.revision,paused:false},provider}),
    generate:async (data, signal) => { generations++; assert.deepEqual(data,{id:key.twin,revision:key.revision,key:provider.key,question,job:job.nonce,useProvider:true});
      return overrides.generate ? overrides.generate(signal) : {answer:"Fixture open."}; }, inbox, origin, approve:overrides.approve ?? (async()=>true),
    journal:{add:r=>records.set(r.id,r),remove:r=>records.delete(r.id),list:()=>[...records.values()]},monotonic:()=>elapsed});
  t.after(()=>service.reset());
  return {service,provider,room,job,calls,records,generations:()=>generations,elapsed:n=>{elapsed=n;},revoke:()=>{central=false;}, offer:(limit)=>service.offer({...provider},[room.ref],limit)};
}

test("signs an explicitly authorized short-lived generated reply and never generates twice for its source", async t => {
  const f=fixture(t);
  await assert.rejects(f.service.offer(f.provider,["*"])); await assert.rejects(f.service.offer({...f.provider,model:"another"},[f.room.ref]));
  assert.equal(f.calls.length,0); await f.offer(); await f.service.tick(); await f.service.tick();
  assert.equal(f.generations(),1); assert.equal(f.calls.filter(c=>c.action==="finish").length,1);
});

test("nine eligible rooms cannot reach the native consent dialog", async t => {
  const rooms = Array.from({ length: 9 }, () => ({ id: randomUUID(), ref: randomUUID(), title: "Fixture", kind: "group" }));
  let approvals = 0;
  const f = fixture(t, { rooms, approve: async () => { approvals++; return true; } });
  await assert.rejects(f.service.offer(f.provider, rooms.map(room => room.ref)));
  assert.equal(approvals, 0);
  await f.service.offer(f.provider, rooms.slice(0, 8).map(room => room.ref));
  assert.equal(approvals, 1);
});

test("a mismatched input hash, selected room, or expired challenge prevents provider dispatch", async t => {
  for(const mode of ["hash","room","expired"]){
    const f=fixture(t, mode==="hash"?{dispatch:{inputHash:"0".repeat(64)}}:{}); await f.offer();
    if(mode==="room") f.job.room=randomUUID(); if(mode==="expired") f.job.expires=99999;
    await f.service.tick(); assert.equal(f.generations(),0);assert.equal(f.records.size,0);
  }
});

for (const reason of ["stop","revoke","model","expiry"]) test("discards an in-flight generated answer after " + reason, async t => {
  const started=Promise.withResolvers(), release=Promise.withResolvers(); let sent;
  const f=fixture(t,{generate:async signal=>{sent=signal; started.resolve();await release.promise;return {answer:"Must stay private."};}});
  await f.offer();const pending=f.service.tick();await started.promise;
  if(reason==="stop"){f.service.reset();assert(sent.aborted);} if(reason==="revoke")f.revoke();
  if(reason==="model") f.provider.model="new-model"; if(reason==="expiry")f.elapsed(50000);
  release.resolve();await pending; assert.equal(f.calls.some(c=>c.action==="finish"),false);
});

test("an Inbox notice cannot authorize a prior draft, another grant or another room", async () => {
  const box={hidden:true,textContent:""},draft=Object.assign(new EventTarget(),{value:""}), input=s=>{draft.value=s;draft.dispatchEvent(new Event("input"));};
  let room="one",next={id:"grant1",provider:{name:"Fixture",model:"M",destination:"https://model.example"}};
  const notice=generatedComposerNotice({api:async()=>({notice:next}),me:()=>({id:"sender",generatedAnswer:true}),room:()=>room,el:id=>id==="draft"?draft:box,t:()=>next.provider.destination});
  input("already typed");await notice.refresh();assert.equal(notice.forDraft(),undefined);
  input("");input("informed");assert.equal(notice.forDraft(),"grant1");
  next={...next,id:"grant2"};await notice.refresh();assert.equal(notice.forDraft(),undefined);
  input("");input("again");assert.equal(notice.forDraft(),"grant2");room="two";assert.equal(notice.forDraft(),undefined);
});

test("an uncertain text send preserves its nonce and loses its provider marker if an attachment is added or notice changes", () => {
  const text = { room: "room", kind: "text", body: "Fixture caption" };
  const initial = prepareInboxPost(null, { ...text, generatedNotice: "first" });
  const retry = prepareInboxPost(initial, { ...text, generatedNotice: "first" });
  assert.deepEqual(retry, initial);
  for (const generatedNotice of [undefined, "second"]) {
    const stripped = prepareInboxPost(initial, { ...text, generatedNotice });
    assert.equal(stripped.nonce, initial.nonce);
    assert.equal(stripped.generatedNotice, undefined);
    assert.equal(prepareInboxPost(stripped, { ...text, generatedNotice: "first" }).generatedNotice, undefined);
  }
});

test("a future-room signature requires explicit kind consent and rejects a different room type", async t => {
  for (const kind of ["group","direct"]) {
    let shown;
    const f = fixture(t, {approve: async detail => { shown = detail; return true; }});
    await f.service.offer(f.provider, ["all-direct"]);
    assert.deepEqual(shown.kinds, ["direct"]);
    f.job.room = randomUUID();
    f.job.kind = kind;
    await f.service.tick();
    assert.equal(f.generations(), kind === "direct" ? 1 : 0);
  }
});


test("renewable permission requires an explicit valid daily limit and survives expiry of only its original pairing", async t => {
  const f = fixture(t);
  for (const invalid of [0, 721, 3.5, "5"]) await assert.rejects(f.offer(invalid));
  assert.equal(f.calls.length, 0);
  await f.offer(5);
  await f.service.tick();
  f.elapsed(91000);
  f.job.source++;
  await f.service.tick();
  assert.equal(f.generations(), 2);
  assert.equal(f.calls.filter(c => c.action === "offer").length, 1);
  assert.equal(f.calls.filter(c => c.action === "renew").length, 1);
  assert.equal(f.service.whileOpen(), true);
  f.service.reset();
  await f.service.tick();
  assert.equal(f.service.whileOpen(), false);
  assert.equal(f.generations(), 2);
});

test("renewal after a network outage requires a verified same-session receipt", async t => {
  let offline = true;
  const f = fixture(t, { beforeLease: async () => {
    if (offline) throw Object.assign(Error("offline"), { code:"INBOX_NETWORK_UNAVAILABLE" });
  } });
  await f.offer(5);
  f.elapsed(91000);
  await f.service.tick();
  assert.equal(f.service.whileOpen(), true);
  assert.equal(f.generations(), 0);
  offline = false;
  await f.service.tick();
  assert.equal(f.generations(), 1);

  const denied = fixture(t, { renewReceipt:{id:randomUUID()} });
  await denied.offer(5);
  denied.elapsed(91000);
  await denied.service.tick();
  assert.equal(denied.generations(), 0);
  assert.equal(denied.service.whileOpen(), false);
});

test("one online signer enforces five attempts per rolling ten minutes and the daily cap", async t => {
  const f = fixture(t);
  await f.offer(6);
  for (let i=0;i<7;i++) { f.job.source++; await f.service.tick(); }
  assert.equal(f.generations(),5);
  f.elapsed(601000);
  f.job.source++;
  await f.service.tick();
  assert.equal(f.generations(),6);
  f.job.source++;
  await f.service.tick();
  assert.equal(f.generations(),6);
  f.elapsed(86401000);
  await f.service.tick();
  assert.equal(f.generations(),7);
});

test("central Stop is observed while the local daily cap blocks new claims", async t => {
  const f = fixture(t);
  await f.offer(1);
  await f.service.tick();
  f.revoke();
  await f.service.tick();
  assert.equal(f.generations(), 1);
  assert.equal(f.service.whileOpen(), false);
});

test("closing the approving desktop during a renewal prevents signing or dispatch", async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const f = fixture(t, {beforeLease:async()=>{entered.resolve();await release.promise;}});
  await f.offer(5);
  f.elapsed(91000);
  const running = f.service.tick();
  await entered.promise;
  f.service.reset();
  release.resolve();
  await running;
  assert(!f.calls.some(c=>c.action==="renew" || c.action==="dispatch"));
  assert.equal(f.generations(),0);
});

test("an idle renewable signer stops on provider change or central revocation", async t => {
  for (const reason of ["provider","revoke"]) {
    const f=fixture(t);
    await f.offer(5);
    if (reason==="provider") f.provider.key=randomUUID();
    else f.revoke();
    await f.service.tick();
    assert.equal(f.service.whileOpen(),false);
    assert.equal(f.generations(),0);
  }
});
