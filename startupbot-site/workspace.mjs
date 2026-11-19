import {siteLocales, sitePath, languageLinks} from './site-locales.mjs';

export function workspacePage(lang, {id, configured=false, ready=false, error=false}={}) {
  const t = siteLocales[lang].portal;
  const base = sitePath(lang, '');
  const path = base + 'app/';
  const authQuery = '?return_to=' + encodeURIComponent(path);
  const privateId = id ? id.replace(/[&<>"']/g, c => '&#'+c.charCodeAt(0)+';') : '';
  const macPreview = '<details class="workspace" id="mac-preview"><summary>'+t.macTitle+'</summary><p>'+t.macHelp+'</p><a class="button" rel="noreferrer" href="http://127.0.0.1:18868/">'+t.macOpen+'</a></details>';
  const action = !id ? '<a class="button" target="_top" href="/signin-with-chatgpt'+authQuery+'">'+t.login+'</a><p>'+t.identity+'</p>' :
    ready ? '<form method="post" action="'+path+'launch"><button class="button">'+t.open+'</button></form>' : '';
  const status = error ? t.unavailable : !configured ? t.preview : id && !ready ? t.pending : '';
  return '<!doctype html><html lang="'+lang+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+t.title+' · StartupBot</title><link rel="icon" href="/mark.png"><link rel="stylesheet" href="/style.css"><script src="/theme.js"></script></head><body><header class="wrap"><a class="brand" href="'+base+'"><img src="/mark.png" alt="">StartupBot</a><nav>'+languageLinks(lang, 'app/')+'</nav></header><main class="wrap webapp cloud-app"><h1>'+t.title+'</h1><p>'+t.intro+'</p><section class="chatbox">'+action+(status?'<p role="status">'+status+'</p>':'')+(id?'<details><summary>'+t.id+'</summary><code>'+privateId+'</code></details><p><a target="_top" href="/signout-with-chatgpt'+authQuery+'">'+t.signout+'</a></p>':'')+'</section>'+macPreview+'<footer class="cloud-footer"><a href="'+path+'chat/">'+t.quick+'</a><a href="'+path+'local/">'+t.local+'</a><a href="'+base+'privacy/">'+t.privacy+'</a></footer></main></body></html>';
}

function workspaceRegistry(value) {
  const entries = JSON.parse(value || '[]');
  if (!Array.isArray(entries)) throw Error('Invalid workspace list');
  const byUser = new Map(), origins = new Set(), tokens = new Set();
  for (const entry of entries) {
    const {id, origin, token} = entry;
    const url = new URL(origin);
    if (typeof id !== 'string' || !id.trim() || typeof token !== 'string' || !/^\S{24,}$/.test(token) ||
        url.protocol !== 'https:' || url.origin !== origin || byUser.has(id) || origins.has(origin) || tokens.has(token)) throw Error('Invalid workspace');
    byUser.set(id, {origin, token});
    origins.add(origin);
    tokens.add(token);
  }
  return byUser;
}

export async function workspaceWeb(request, env, remote=fetch) {
  const url = new URL(request.url);
  const match = /^\/(?:([a-z][a-z0-9-]*)\/)?app(?:\/(launch))?\/?$/.exec(url.pathname);
  if (!match || (match[1] && (match[1] === 'vi' || !Object.hasOwn(siteLocales, match[1])))) return null;
  const lang = match[1] || 'vi';
  const id = request.headers.get('oai-authenticated-user-email') && request.headers.get('oai-authenticated-user-id');
  const headers = {'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
  const page = (props, status=200) => new Response(request.method==='HEAD'?null:workspacePage(lang,{id,...props}),{status,headers:{...headers,'Referrer-Policy':'same-origin','Content-Type':'text/html; charset=utf-8'}});
  const launch = Boolean(match[2]);
  const methods = launch ? ['POST'] : ['GET','HEAD'];
  if (!methods.includes(request.method)) return new Response(null,{status:405,headers:{...headers,Allow:methods.join(', ')}});
  if (launch && !id) return new Response(null,{status:401,headers});
  if (launch && request.headers.get('origin') !== url.origin) return new Response(null,{status:403,headers});
  try {
    const registry = workspaceRegistry(env.STARTUPBOT_WEB_WORKSPACES);
    const workspace = registry.get(id);
    const props = {configured:registry.size > 0,ready:Boolean(workspace)};
    if (!launch || !workspace) return page(props,launch?403:200);
    const res = await remote(workspace.origin+'/api/auth/pairing',{
      method:'POST', redirect:'error', signal:AbortSignal.timeout(10000),
      headers:{Authorization:'Bearer '+workspace.token,'Content-Type':'application/json'},
      body:JSON.stringify({label:'StartupBot Web',scopes:['admin','client'],ttlMs:60000,tokenTtlMs:28800000})
    });
    if (!res.ok) return page({...props,error:true},503);
    const {code} = await res.json();
    if (typeof code!=='string' || !/^[2-9A-HJ-NP-Z]{4}(?:-[2-9A-HJ-NP-Z]{4}){2}$/.test(code)) return page({...props,error:true},503);
    return new Response(null,{status:303,headers:{...headers,Location:workspace.origin+'/pair#code='+code}});
  } catch {
    return page({error:true},503);
  }
}
