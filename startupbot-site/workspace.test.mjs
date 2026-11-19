import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceWeb} from './workspace.mjs';

const root = 'https://portal.example';
const accounts = ['alice','bob'].map(id=>({id,origin:'https://'+id+'.example',token:id.repeat(12)}));
const env = {STARTUPBOT_WEB_WORKSPACES:JSON.stringify(accounts)};
function request(path, id, method='GET', origin=root) {
  const headers = {origin};
  if (id) Object.assign(headers, {'oai-authenticated-user-id':id,'oai-authenticated-user-email':id+'@example.org'});
  return new Request(root+path,{method,headers});
}
test('anonymous visitors and unassigned accounts can never mint a workspace session', async()=>{
  let calls=0;
  const remote=()=>{ calls++; throw Error(); };
  for(const [id,origin,expected] of [[null,root,401],['other',root,403],['alice','https://external.example',403]]) {
    assert.equal((await workspaceWeb(request('/app/launch',id,'POST',origin),env,remote)).status,expected);
  }
  assert.equal((await workspaceWeb(request('/app/launch','alice'),env,remote)).status,405);
  assert.equal(calls,0);
});
test('login selects only the provisioned origin and issues a short native pairing',async()=>{
  for(const account of accounts) {
    const response=await workspaceWeb(request('/en/app/launch?workspace=bob',account.id,'POST'),env,async(url,init)=>{
      assert.equal(url,account.origin+'/api/auth/pairing');
      assert.equal(init.headers.Authorization,'Bearer '+account.token);
      assert.equal(init.redirect,'error');
      assert.equal(init.headers.Cookie,undefined);
      assert.equal(JSON.parse(init.body).ttlMs,60000);
      return Response.json({code:'ABCD-EFGH-JKLM',url:'https://other.example'});
    });
    assert.equal(response.status,303);
    assert.equal(response.headers.get('location'),account.origin+'/pair#code=ABCD-EFGH-JKLM');
    assert.match(response.headers.get('cache-control'),/no-store/);
  }
});
test('invalid tenant registry, rejected pairing or unusable code fails closed',async()=>{
  for (const entries of [[...accounts,accounts[0]],[accounts[0],{...accounts[1],origin:accounts[0].origin}],[{...accounts[0],origin:'http://example.org'}]]) {
    assert.equal((await workspaceWeb(request('/app/','alice'),{STARTUPBOT_WEB_WORKSPACES:JSON.stringify(entries)})).status,503);
  }
  for (const remote of [()=>Response.json({}, {status:401}),()=>Response.json({code:'wrong'}),()=>{throw Error();}]) {
    assert.equal((await workspaceWeb(request('/app/launch','alice','POST'),env,remote)).status,503);
  }
  const pending=await workspaceWeb(request('/app/','alice'),{});
  assert.doesNotMatch(await pending.text(),/action="\/app\/launch"/);
  assert.equal(await workspaceWeb(request('/app/local/','alice'),env),null);
});

test('both portals offer a user-initiated Mac preview without sending site credentials', async()=>{
  for(const path of ['/app/', '/en/app/']) {
    const response = await workspaceWeb(request(path),{});
    const html = await response.text();
    assert.match(html,/<details[^>]*id="mac-preview"/);
    assert.match(html,/<a [^>]*rel="noreferrer" href="http:\/\/127\.0\.0\.1:18868\/"/);
    assert.doesNotMatch(html,/(?:src|action)="http:\/\/127\.0\.0\.1|#code=|omb_pair_/);
  }
});
