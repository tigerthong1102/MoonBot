const prefix = 'startupbot.chat.copy.v1.';
export function savedChats(w, current, restore, report) {
  const el = id => document.getElementById(id);
  const select = el('copies');
  function list(preferred) {
    const keys = [];
    try {
      for (let i=0;i<localStorage.length;i++) {
        const key=localStorage.key(i);
        if (key?.startsWith(prefix)) keys.push(key);
      }
    } catch { return; }
    select.replaceChildren();
    for (const key of keys.sort().reverse()) {
      try {
        const {at,title} = JSON.parse(localStorage.getItem(key));
        if (typeof title !== 'string' || !Number.isFinite(at)) continue;
        const date = new Date(at).toLocaleString(document.documentElement.lang);
        select.add(new Option(date+' · '+title.slice(0,50),key));
      } catch {}
    }
    if (preferred && keys.includes(preferred)) select.value = preferred;
    el('copies-panel').hidden = !select.length;
  }
  function save() {
    try {
      const messages = current();
      if (!messages.length) return;
      const at = Date.now(), key = prefix+at+'.'+crypto.randomUUID();
      localStorage.setItem(key,JSON.stringify({at,title:messages[0].content.split('\n')[0].slice(0,50),messages}));
      list(key);
      report(w.saved);
    } catch { report(w.storageError); }
  }
  el('save-copy').onclick = save;
  el('open-copy').onclick = () => {
    try {
      const entry = JSON.parse(localStorage.getItem(select.value));
      const messages = entry?.messages;
      if (!Array.isArray(messages) || !messages.length || messages.length>40 ||
          messages.some((m,i)=>m?.role !== (i%2?'assistant':'user') || typeof m.content !== 'string')) throw Error();
      if ((current().length || el('question').value.trim() || el('doc').files.length) && !confirm(w.replaceChat)) return;
      restore(messages);
      report(w.restored);
    } catch { report(w.storageError); }
  };
  el('delete-copy').onclick = () => {
    if (!select.value || !confirm(w.confirmDelete)) return;
    try { localStorage.removeItem(select.value); list(); report(w.deleted); } catch { report(w.storageError); }
  };
  window.addEventListener('storage',e=>{if (!e.key || e.key.startsWith(prefix)) list(select.value);});
  list();
}
