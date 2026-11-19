import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {workspaceWeb} from '../workspace.mjs';

const {launchVerificationServer,runControlOmb}=await import(pathToFileURL(resolve(process.env.STARTUPBOT_REPO,'scripts/control-omb.ts')));
const {chromium}=await import(process.env.STARTUPBOT_PLAYWRIGHT || 'playwright');
const temp=await mkdtemp(join(tmpdir(),'startupbot-web-fixture-'));
const fixtures=[], registry=[], fixtureByHost=new Map();
let browser, gateway;
async function coreApi(base,method,path,payload) {
  const options = {method, headers: {'Content-Type':'application/json'}};
  if (payload !== undefined) options.body = JSON.stringify(payload);
  const response = await fetch(base + path, options);
  assert.ok(response.ok,method+' '+path+' '+response.status);
  return response.json();
}
try {
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',join(temp,'key'),'-out',join(temp,'cert')],{stdio:'ignore'});
  const proxyHeaders=(host,headers)=>({...headers,host,'x-forwarded-host':host,'x-forwarded-for':'192.0.2.10','x-forwarded-proto':'https'});
  gateway=https.createServer({key:await readFile(join(temp,'key')),cert:await readFile(join(temp,'cert'))},async(req,res)=>{
    const host=req.headers.host;
    if (fixtureByHost.has(host)) {
      const base=fixtureByHost.get(host);
      const upstream=http.request(base+req.url,{method:req.method,headers:proxyHeaders(host,req.headers)},r=>{
        res.writeHead(r.statusCode,r.headers); r.pipe(res);
      });
      res.on('close',()=>upstream.destroy());
      upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
      req.pipe(upstream); return;
    }
    if (host!=='portal.localhost:'+gateway.address().port) {res.writeHead(404);res.end();return;}
    const id=/^test-id=(alice|bob)$/.exec(req.headers.cookie || '')?.[1];
    const headers={origin:req.headers.origin || ''};
    if(id)Object.assign(headers,{'oai-authenticated-user-id':id,'oai-authenticated-user-email':id+'@example.test'});
    const response=await workspaceWeb(new Request('https://'+host+req.url,{method:req.method,headers}),{STARTUPBOT_WEB_WORKSPACES:JSON.stringify(registry)},async(target,init)=>{
      const u=new URL(target);
      assert.ok(fixtureByHost.has(u.host));
      return fetch(fixtureByHost.get(u.host)+u.pathname,{...init,headers:proxyHeaders(u.host,init.headers)});
    });
    res.writeHead(response?.status ?? 404,response?Object.fromEntries(response.headers):{});
    res.end(response?await response.text():'');
  });
  await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
  const port=gateway.address().port, portal='https://portal.localhost:'+port;
  for (const id of ['alice','bob']) {
    const fixture=await launchVerificationServer({},undefined,undefined,undefined,undefined,undefined,[],undefined,resolve(process.env.STARTUPBOT_UI));
    fixtures.push(fixture);
    const base=fixture.info.url, host=id+'.localhost:'+port;
    fixtureByHost.set(host,base);
    const invite=await coreApi(base,'POST','/api/auth/pairing',{label:'test portal',scopes:['client','admin'],tokenTtlMs:3600000});
    const {token}=await coreApi(base,'POST','/api/auth/pair',{code:invite.code});
    registry.push({id,origin:'https://'+host,token});
  }
  const aliceBase=fixtures[0].info.url;
  const model=process.env.STARTUPBOT_FIXTURE_MODEL;
  if(model) {
    await coreApi(aliceBase,'PATCH','/api/config',{openaiCompat:{key:'fixture',url:'http://127.0.0.1:11434/v1',model}});
    await coreApi(aliceBase,'POST','/api/instances/openaiCompat/refresh-models',{});
    await coreApi(aliceBase,'PATCH','/api/instances/openaiCompat',{tools:false});
  }
  const {bot}=await runControlOmb(['new-bot','--name','Workspace QA','--url',aliceBase]);
  if(model) await runControlOmb(['set-model','--bot',bot.id,'--instance','openaiCompat','--model',model,'--url',aliceBase]);
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({ignoreHTTPSErrors:true});
  await context.addInitScript(()=>{localStorage.setItem('omb-language','en');localStorage.setItem('omb-analytics-opt-out','1');localStorage.setItem('omb-email-gate','skipped');});
  context.setDefaultTimeout(15000);
  const page=await context.newPage();
  const native=registry[0].origin;
  {const anon=await context.request.get(native+'/api/bots');assert.equal(anon.status(),403); assert.match(await anon.text(),/pair this device/);}
  await page.goto(portal+'/en/app/');
  await page.getByRole('link',{name:'Sign in to StartupBot'}).waitFor();
  await context.addCookies([{name:'test-id',value:'alice',url:portal}]);
  await page.reload();
  const opened=page.waitForResponse(r=>r.url().endsWith('/app/launch'));
  await page.getByRole('button',{name:'Open workspace'}).click();
  assert.equal((await opened).status(),303,'launch');
  const form=page.locator('form').filter({has:page.locator('#pair-code')});
  await form.locator('button[type=submit]').click({timeout:20000});
  await page.waitForURL(native+'/',{timeout:20000});
  const api=async(path)=>{const r=await context.request.get(native+path);assert.equal(r.status(),200,path);return r.json()};
  assert.equal((await api('/api/auth/session')).kind,'session');
  const button = name => page.getByRole('button',{name,exact:true});
  await button('Apps').click();
  const apps = page.getByRole('dialog',{name:'Apps'});
  await apps.getByRole('heading',{name:'Your MCP servers'}).waitFor();
  await apps.getByText('Google Drive',{exact:true}).waitFor();
  await apps.getByRole('button',{name:'Close plugins'}).click();
  await button('Published apps').click();
  await page.getByRole('heading',{name:'Published apps',exact:true}).waitFor();
  await api('/api/published-apps');

  const before = (await api('/api/bots')).bots;
  await button('New or share').click();
  const created = page.waitForResponse(r=>r.request().method()==='POST' && new URL(r.url()).pathname==='/api/bots');
  await page.getByRole('menuitem',{name:'New Bot',exact:true}).click();
  assert.ok((await created).ok());
  const newBot = (await api('/api/bots')).bots.find(b=>!before.some(old=>old.id===b.id));
  assert.ok(newBot);
  await page.getByRole('textbox',{name:'Message '+newBot.name,exact:true}).waitFor();

  await button('Automations').click();
  await button('New').first().click();
  await button('Set it up yourself').click();
  await button('Continue').click();
  const event = page.getByRole('dialog',{name:'Create calendar event'});
  const title = 'Workspace schedule check';
  await event.getByRole('textbox',{name:'Title'}).fill(title);
  await event.getByRole('textbox',{name:'Description'}).fill('Summarize the inventory worksheet.');
  await event.getByRole('button',{name:'Workspace QA Workspace QA'}).click();
  const future = new Date();
  future.setFullYear(future.getFullYear()+1);
  await event.locator('input[type=date]').fill(future.toISOString().slice(0,10));
  await event.getByRole('button',{name:'Save'}).click();
  await button(title).waitFor();
  assert.ok((await api('/api/routines')).routines.some(r=>r.name===title && r.enabled));
  assert.ok(!(await coreApi(fixtures[1].info.url,'GET','/api/routines')).routines.some(r=>r.name===title));
  await page.reload();
  await button('Automations').click();
  await button(title).waitFor();
  await page.getByRole('complementary').getByRole('button',{name:/^Workspace QA Model:/}).click();
  assert.equal((await context.request.get(registry[1].origin+'/api/bots')).status(),403);
  const composer=page.locator('textarea[aria-label*="Workspace QA"]');
  if(!await composer.count())await page.getByText('Workspace QA',{exact:true}).first().click();
  const prompt='Một kho có 17 sản phẩm và nhận thêm 8. Tổng cộng là bao nhiêu? Chỉ trả lời bằng chữ số.';
  await composer.fill(prompt);await composer.press('Enter');
  let answer;
  for(let i=0;i<120&&!answer;i++) {
    const {messages}=await api('/api/threads/'+bot.activeTaskId+'/messages?limit=30');
    const idx=messages.findIndex(m=>m.role==='user'&&m.text===prompt);
    if(idx>=0)answer=messages.slice(idx+1).find(m=>m.role==='bot'&&m.kind==='text'&&m.text.trim())?.text;
    if(!answer)await new Promise(r=>setTimeout(r,1000));
  }
  assert.ok(answer,'agent response');if(model)assert.match(answer,/\b25\b/);
  await page.reload();await page.getByText(prompt,{exact:true}).first().waitFor();
  const logout=await context.request.post(native+'/api/auth/logout',{headers:{origin:native}});
  assert.equal(logout.status(),200);
  assert.equal((await context.request.get(native+'/api/bots')).status(),403);
  console.log('PASS: login handoff, full renderer, app catalog, published apps, bot creation and persisted scheduled automation, tenant isolation, agent reply, reload and logout.',model || 'fixture');
} finally {
  await browser?.close();
  gateway?.closeAllConnections();gateway?.close();
  await Promise.all(fixtures.map(f=>f.close()));
  await rm(temp,{recursive:true,force:true});
}
