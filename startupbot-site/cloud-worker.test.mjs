import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,createHash } from 'node:crypto';
import { hostedWeb } from './cloud-worker.mjs';

const origin='https://startupbot.example';
const env={STARTUPBOT_WEB_SESSION_KEY:randomBytes(32).toString('base64url')};
function post(path,body={},token='',source=origin) {
  return new Request(origin+path,{method:'POST',headers:{origin:source,cookie:token},body:new URLSearchParams(body)});
}
async function authorize(key) {
  const start=await hostedWeb(post('/app/connect'),env);
  const auth=new URL(start.headers.get('location'));
  assert.equal(auth.origin,'https://openrouter.ai');
  assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
  const set=start.headers.get('set-cookie');
  assert.match(set,/HttpOnly; Secure; SameSite=Lax/);
  const url=new URL(auth.searchParams.get('callback_url'));
  url.search=new URLSearchParams({code:'disposable',state:auth.searchParams.get('state')});
  const callback=await hostedWeb(new Request(url,{headers:{cookie:set.split(';')[0]}}),env,async(target,init)=>{
    assert.equal(target,'https://openrouter.ai/api/v1/auth/keys');
    assert.equal(createHash('sha256').update(JSON.parse(init.body).code_verifier).digest('base64url'),auth.searchParams.get('code_challenge'));
    return Response.json({key});
  });
  const session=callback.headers.getSetCookie().find(c=>c.startsWith('__Host-startupbot-session='));
  assert.ok(session && !session.includes(key));
  return session.split(';')[0];
}
test('old browser entry and private local path are separate',async()=>{
  const r=await hostedWeb(new Request(origin+'/en/app/chat/'),env);
  assert.equal(r.headers.get('cache-control'),'private, no-store');
  const html=await r.text();
  assert.match(html,/method="post" action="\/en\/app\/chat\/connect"/);
  assert.doesNotMatch(html,/wllama|wasm|huggingface|id="workspace"/);
  assert.equal(await hostedWeb(new Request(origin+'/app/local/'),env),null);
});
test('separate users call only the free provider and prior turns stay scoped to the submitted page',async()=>{
  for (const key of ['test-account-A','test-account-B']) {
    const session=await authorize(key);
    const r=await hostedWeb(post('/app/send',{message:'hello',history:'[]'},session),env,async(url,init)=>{
      assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(init.headers.Authorization,'Bearer '+key);
      const args=JSON.parse(init.body);assert.equal(args.model,'openrouter/free');
      assert.deepEqual(args.provider.max_price,{prompt:0,completion:0});
      assert.deepEqual(args.messages.slice(1),[{role:'user',content:'hello'}]);
      return Response.json({choices:[{message:{content:'answer <tag>'}}]});
    });
    const html=await r.text();assert.equal(r.status,200);assert.match(html,/answer &lt;tag&gt;/);
    assert.doesNotMatch(html,/test-account|<tag>/);
  }
});
test('a missing session, invalid state or foreign origin never starts an inference request',async()=>{
  const never=async()=>{throw Error('unexpected upstream call')};
  assert.equal((await hostedWeb(post('/app/send'),env,never)).status,401);
  assert.equal((await hostedWeb(post('/app/connect',{},'','https://other.example'),env,never)).status,403);
  const r=await hostedWeb(new Request(origin+'/web-auth/callback?code=invalid&state=wrong'),env,never);
  assert.equal(r.headers.get('location'),'/app/chat/?auth=failed');
});
test('quota failure preserves draft, with no model change or retry',async()=>{
  const session=await authorize('tester');
  let requests=0;
  const r=await hostedWeb(post('/en/app/send',{message:'my draft'},session),env,async()=>{requests++;return new Response(null,{status:429})});
  assert.equal(requests,1);assert.equal(r.status,429);
  assert.match(await r.text(),/my draft<\/textarea>/);
  const out=await hostedWeb(post('/en/app/disconnect',{},session),env);
  assert.equal(out.status,303);assert.match(out.headers.getSetCookie()[0],/Max-Age=0/);
});
