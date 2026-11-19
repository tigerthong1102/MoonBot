import {siteLocales, sitePath} from './site-locales.mjs';
import { cloudPage } from './cloud-view.mjs';

const flowCookie = '__Host-startupbot-flow';
const sessionCookie = '__Host-startupbot-session';
const baseHeaders = {'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
const encoder = new TextEncoder();
function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
function from64(value) {
  return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
}
function nonce(n) { return crypto.getRandomValues(new Uint8Array(n)); }
function cookie(name,value,seconds) {
  return name+'='+value+'; Max-Age='+seconds+'; HttpOnly; Secure; SameSite=Lax; Path=/';
}
async function sealKey(env) {
  return crypto.subtle.importKey('raw',from64(env.STARTUPBOT_WEB_SESSION_KEY),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
async function seal(env,origin,name,payload,seconds) {
  const iv=nonce(12);
  const data=encoder.encode(JSON.stringify({...payload,exp:Date.now()+seconds*1000}));
  const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(origin+name)},await sealKey(env),data);
  return cookie(name,base64url(iv)+'.'+base64url(new Uint8Array(bytes)),seconds);
}
async function read(request,env,name) {
  const item=(request.headers.get('Cookie')||'').split(';').map(p=>p.trim()).find(p=>p.startsWith(name+'='));
  if (!item || item.length>4000) return null;
  try {
    const [iv,data]=item.slice(name.length+1).split('.');
    const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(iv),additionalData:encoder.encode(new URL(request.url).origin+name)},await sealKey(env),from64(data));
    const result=JSON.parse(new TextDecoder().decode(bytes));
    return result.exp>Date.now()?result:null;
  } catch { return null; }
}
function redirect(url,cookies=[]) {
  const headers=new Headers({...baseHeaders,Location:url});
  cookies.forEach(c=>headers.append('Set-Cookie',c));
  return new Response(null,{status:303,headers});
}
function html(lang,props={},status=200) {
  return new Response(cloudPage(lang,props),{status,headers:{...baseHeaders,'Referrer-Policy':'same-origin','Content-Type':'text/html; charset=utf-8'}});
}
async function limitedText(request,max) {
  if (Number(request.headers.get('content-length'))>max) throw Error();
  if (!request.body) return '';
  const reader=request.body.getReader();
  const decoder=new TextDecoder();
  let bytes=0,text='';
  try {
    while (true) {
      const part=await reader.read();
      if (part.done) break;
      bytes+=part.value.length;
      if (bytes>max) { await reader.cancel(); throw Error(); }
      text+=decoder.decode(part.value,{stream:true});
    }
    return text+decoder.decode();
  } finally { reader.releaseLock(); }
}
async function callback(request,env,remote) {
  const url=new URL(request.url);
  const flow=await read(request,env,flowCookie);
  const path=sitePath(Object.hasOwn(siteLocales, flow?.lang) ? flow.lang : 'vi', 'app/chat/');
  const clear=cookie(flowCookie,'',0);
  const code=url.searchParams.get('code');
  if (!flow || !code || code.length>1024 || url.searchParams.get('state')!==flow.state) return redirect(path+'?auth=failed',[clear]);
  try {
    const response=await remote('https://openrouter.ai/api/v1/auth/keys',{
      method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),
      body:JSON.stringify({code,code_verifier:flow.verifier,code_challenge_method:'S256'})
    });
    if (!response.ok) throw Error();
    const {key}=JSON.parse(await limitedText(response,16000));
    if (typeof key!=='string' || !key.length || key.length>1024 || /\s/.test(key)) throw Error();
    return redirect(path,[clear,await seal(env,url.origin,sessionCookie,{key},8*3600)]);
  } catch { return redirect(path+'?auth=failed',[clear]); }
}
function validHistory(text) {
  const turns=JSON.parse(text||'[]');
  if (!Array.isArray(turns) || turns.length>12 || turns.length%2 || turns.some((m,i)=>m?.role!==(i%2?'assistant':'user') || typeof m.content!=='string' || !m.content.length || m.content.length>12000)) throw Error();
  return turns.map(({role,content})=>({role,content}));
}
export async function hostedWeb(request,env,remote=fetch) {
  const url=new URL(request.url);
  if (url.pathname==='/web-auth/callback') return request.method==='GET'?callback(request,env,remote):new Response(null,{status:405,headers:baseHeaders});
  const match=/^\/(?:([a-z][a-z0-9-]*)\/)?app(?:\/chat)?(?:\/(connect|send|disconnect))?\/?$/.exec(url.pathname);
  if (!match || (match[1] && (match[1] === 'vi' || !Object.hasOwn(siteLocales, match[1])))) return null;
  const lang=match[1] || 'vi', path=sitePath(lang, 'app/chat/'), action=match[2];
  if (!action && ['GET','HEAD'].includes(request.method)) {
    if(request.method==='HEAD')return new Response(null,{headers:{...baseHeaders,'content-type':'text/html; charset=utf-8'}});
    return html(lang,{connected:Boolean(await read(request,env,sessionCookie)),error:url.searchParams.get('auth')==='failed'?'signfail':''});
  }
  if (!action || request.method!=='POST') return new Response(null,{status:405,headers:baseHeaders});
  if (request.headers.get('origin')!==url.origin) return new Response(null,{status:403,headers:baseHeaders});
  if (action==='disconnect') return redirect(path,[cookie(sessionCookie,'',0),cookie(flowCookie,'',0)]);
  if (action==='connect') {
    if (!env.STARTUPBOT_WEB_SESSION_KEY) return html(lang,{error:'unavailable'},503);
    const verifier=base64url(nonce(32)), state=base64url(nonce(24));
    const challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(verifier))));
    const auth=new URL('https://openrouter.ai/auth');
    auth.search=new URLSearchParams({callback_url:url.origin+'/web-auth/callback',state,code_challenge:challenge,code_challenge_method:'S256',key_label:'StartupBot Web',expiration:'1-day',limit:'0.01'});
    return redirect(auth.href,[await seal(env,url.origin,flowCookie,{verifier,state,lang},600)]);
  }
  const sess=await read(request,env,sessionCookie);
  if (!sess) return html(lang,{error:'expired'},401);
  let turns=[],draft='';
  try {
    if (request.headers.get('content-type')?.split(';')[0]!=='application/x-www-form-urlencoded') throw Error();
    const fields=new URLSearchParams(await limitedText(request,196608));
    turns=validHistory(fields.get('history'));
    draft=(fields.get('message')||'').trim();
    if (!draft || draft.length>6000) throw Error();
  } catch { return html(lang,{connected:true,turns,draft:draft.slice(0,6000),error:'invalid'},400); }
  const message={role:'user',content:draft};
  try {
    const response=await remote('https://openrouter.ai/api/v1/chat/completions',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(65000),
      headers:{Authorization:'Bearer '+sess.key,'Content-Type':'application/json','HTTP-Referer':url.origin,'X-OpenRouter-Title':'StartupBot'},
      body:JSON.stringify({model:'openrouter/free',provider:{max_price:{prompt:0,completion:0}},max_tokens:800,
        messages:[{role:'system',content:'You are StartupBot, a web assistant. Respond in the user’s language. You can help with text. Do not claim to have accessed files, sent mail, or performed actions outside this conversation.'},...turns,message]})
    });
    if (response.status===401) return redirect(path+'?auth=failed',[cookie(sessionCookie,'',0)]);
    if ([402,429,503].includes(response.status)) return html(lang,{connected:true,turns,draft,error:'wait'},response.status===503?503:429);
    if (!response.ok) throw Error();
    const reply=JSON.parse(await limitedText(response,131072)).choices?.[0]?.message?.content;
    if (typeof reply!=='string' || !reply.trim() || reply.length>12000) throw Error();
    turns.push(message,{role:'assistant',content:reply});
    while (turns.length>12 || (turns.length>2 && encoder.encode(new URLSearchParams({history:JSON.stringify(turns)}).toString()).length>125000)) turns.splice(0,2);
    return html(lang,{connected:true,turns});
  } catch { return html(lang,{connected:true,turns,draft,error:'unavailable'},503); }
}
