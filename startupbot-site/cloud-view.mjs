import {siteLocales, sitePath, languageLinks} from './site-locales.mjs';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
export function cloudPage(lang, {connected=false, turns=[], draft='', error=''}={}) {
  const w = siteLocales[lang].cloud;
  const path = sitePath(lang, 'app/chat/');
  const base = sitePath(lang, '');
  const form = (action,body) => '<form method="post" action="'+path+action+'">'+body+'</form>';
  const messages = turns.map(m=>'<article class="message '+(m.role==='user'?'user':'')+'"><strong>'+(m.role==='user'?w.user:'StartupBot')+'</strong><p>'+escapeHtml(m.content)+'</p></article>').join('');
  return '<!doctype html><html lang="'+lang+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="same-origin"><title>'+w.title+'</title><link rel="icon" href="/mark.png"><script src="/theme.js"></script><link rel="stylesheet" href="/style.css"><script defer src="/web/cloud-client.js"></script></head><body><header class="wrap"><a class="brand" href="'+base+'"><img src="/mark.png" alt="">StartupBot</a><nav class="cloud-nav">'+languageLinks(lang, 'app/chat/')+'</nav></header><main class="wrap webapp cloud-app"><h1>'+w.title+'</h1><p>'+w.intro+'</p><section class="chatbox"><p role="alert">'+(w[error]||'')+'</p>'+
  (connected ? '<div class="cloud-controls"><a class="textbutton" href="'+path+'">'+w.reset+'</a>'+form('disconnect','<button class="textbutton">'+w.bye+'</button>')+'</div><div id="conversation" aria-live="polite">'+messages+'</div>'+form('send','<input type="hidden" name="history" value="'+escapeHtml(JSON.stringify(turns))+'"><label for="message">'+w.prompt+'</label><textarea id="message" name="message" rows="4" maxlength="6000" required placeholder="'+escapeHtml(w.placeholder)+'">'+escapeHtml(draft)+'</textarea><div id="file-tools" hidden><label for="file">'+w.file+'</label><input id="file" type="file" accept=".txt,.csv,.md"><span id="file-error" role="alert" data-error="'+escapeHtml(w.fileError)+'"></span></div><button class="button" data-pending="'+w.sending+'">'+w.send+'</button>') :
  '<p>'+w.consent+'</p>'+form('connect','<button class="button">'+w.login+'</button>'))+
  '<p class="cloud-note">'+w.note+' '+w.readonly+'</p></section><footer class="cloud-footer"><a href="'+base+'privacy/">'+w.privacy+'</a><a href="'+base+'app/local/">'+w.local+'</a></footer></main></body></html>';
}
