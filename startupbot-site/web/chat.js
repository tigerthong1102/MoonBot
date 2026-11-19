import { savedChats } from './saved-chats.js';
import { calculate } from './calculate.js';
import { connectWorkspace } from './workspace.js';
const el = id => document.getElementById(id);
const w = JSON.parse(el('messages').textContent);
const models = {
  compact: {name:'0.5',revision:'9217f5db79a29953eb74d5343926648285ec7e67',sha:'74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db',bytes:491400032},
  quality: {name:'1.5',revision:'91cad51170dc346986eccefdc2dd33a9da36ead9',sha:'6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e',bytes:1117320736}
};
function modelUrl(m) {
  return 'https://huggingface.co/Qwen/Qwen2.5-'+m.name+'B-Instruct-GGUF/resolve/'+m.revision+'/qwen2.5-'+m.name+'b-instruct-q4_k_m.gguf';
}
const contextSize = 4096;
const answerTokens = 512;
const history = [];
let engine, operation;
const status = text => { el('status').textContent = text; };

connectWorkspace(w);
const language = document.documentElement.lang;
savedChats(w,()=>history,messages=>{
  history.splice(0,history.length,...messages);
  el('conversation').replaceChildren();
  el('question').value = '';
  removeDocument();
  for (const message of messages) bubble(message.role,message.content);
  busy(null);
},status);
el('expression').oninput = () => { el('calc-result').textContent = ''; };
function removeDocument() {
  el('doc').value = '';
  el('remove-doc').hidden = true;
}
el('remove-doc').onclick = removeDocument;
el('doc').onchange = () => { el('remove-doc').hidden = !el('doc').files.length; };
el('calculator').onsubmit = event => {
  event.preventDefault();
  el('calc-result').textContent = calculate(el('expression').value,language) ?? w.mathInvalid;
};
async function modelCache(m) {
  try { return await caches.open('startupbot-model-' + m.revision); } catch { return null; }
}
async function modelLabel() {
  const selected = el('model').value;
  const m = models[selected];
  el('consent').textContent = selected === 'compact' ? w.compactConsent : w.consent;
  el('load-model').textContent = w.start;
  try {
    const hit = await (await modelCache(m))?.match(modelUrl(m));
    if (hit && !operation && el('model').value === selected) el('load-model').textContent = w.cached;
  } catch {}
}
let modelSelected = false;
el('model').onchange = () => { modelSelected = true; modelLabel(); };
async function initialModel() {
  try {
    const [quality,compact] = await Promise.all([models.quality,models.compact].map(async m=>(await modelCache(m))?.match(modelUrl(m))));
    if (!modelSelected && !operation && !engine && !quality && compact) el('model').value = 'compact';
  } catch {}
  if (!operation && !engine) modelLabel();
}
initialModel();

function busy(controller) {
  operation = controller;
  el('model').disabled = Boolean(operation);
  el('copies-panel').disabled = Boolean(operation);
  el('save-copy').disabled = Boolean(operation) || !history.length;
  el('export-chat').disabled = Boolean(operation) || !el('conversation').childElementCount;
  el('load-model').disabled = Boolean(operation);
  el('stop').hidden = !operation;
  el('send').disabled = Boolean(operation);
  el('clear').disabled = Boolean(operation);
  el('question').disabled = Boolean(operation);
  el('doc').disabled = Boolean(operation);
  el('remove-doc').disabled = Boolean(operation);
}
async function verifiedModel(signal,m) {
  const cache = await modelCache(m);
  const url = modelUrl(m);
  const hit = await cache?.match(url);
  el('progress').hidden = false;
  el('progress').value = 0;
  status(hit ? w.checking : w.downloading);
  await import('./hash-4.12.0/sha256.js');
  const hash = await globalThis.hashwasm.createSHA256();
  const response = hit || await fetch(url,{signal, credentials:'omit',referrerPolicy:'no-referrer'});
  if (!response.ok || !response.body) throw Error('Model download failed');
  let total = 0, percent = -1;
  const stream = response.body.pipeThrough(new TransformStream({
    transform(chunk,sink) {
      signal.throwIfAborted();
      total += chunk.byteLength;
      if (total > m.bytes) throw Error('Invalid model size');
      hash.update(chunk);
      const next = Math.floor(100 * total / m.bytes);
      if (next !== percent) el('progress').value = percent = next;
      sink.enqueue(chunk);
    }
  }),{signal});
  const payload = await new Response(stream).blob();
  if (total !== m.bytes || hash.digest('hex') !== m.sha) {
    if (hit) await cache.delete(url);
    throw Error('Invalid model digest');
  }
  signal.throwIfAborted();
  let saved = Boolean(hit);
  if (cache && !hit) try {
    await cache.put(url,new Response(payload));
    saved = true;
  } catch {}
  return {payload,saved};
}
el('load-model').onclick = async () => {
  if (engine || operation) return;
  if (!window.WebAssembly || !globalThis.crypto?.subtle) return status(w.unsupported);
  const controller = new AbortController();
  busy(controller);
  let candidate;
  try {
    const {payload,saved} = await verifiedModel(controller.signal,models[el('model').value]);
    const {Wllama} = await import('./runtime-2.3.7/wllama.js');
    controller.signal.throwIfAborted();
    status(w.loading);
    candidate = new Wllama({'single-thread/wllama.wasm':new URL('./runtime-2.3.7/wllama.wasm',import.meta.url).href},{suppressNativeLog:true});
    await candidate.loadModel([payload],{n_ctx:contextSize,n_threads:1,n_batch:96});
    controller.signal.throwIfAborted();
    engine = candidate;
    el('start-panel').hidden = true;
    el('chat').hidden = false;
    status(saved ? w.ready : w.noCache);
  } catch {
    if (candidate) try { await candidate.exit(); } catch {}
    status(controller.signal.aborted ? w.stopped : w.loadError);
  } finally {
    el('progress').hidden = true;
    busy(null);
    if (engine) el('question').focus();
  }
};
el('stop').onclick = () => operation?.abort();
el('clear').onclick = () => {
  history.length = 0;
  removeDocument();
  el('conversation').replaceChildren();
  el('export-chat').disabled = true;
  el('save-copy').disabled = true;
  el('question').value = '';
  el('question').focus();
  status(w.ready);
};
function bubble(role,content) {
  const item = document.createElement('article');
  item.className = 'message ' + role;
  const label = document.createElement('strong');
  label.textContent = role === 'user' ? w.you : 'StartupBot';
  const body = document.createElement('p');
  body.textContent = content;
  item.append(label, body);
  const container = el('conversation');
  while (container.childElementCount >= 40) container.firstElementChild.remove();
  container.append(item);
  container.scrollTop = container.scrollHeight;
  return body;
}
async function promptFor(userMessage) {
  const messages = [...history,userMessage];
  const system = {role:'system',content:'You are StartupBot, a helpful AI assistant. Answer concisely in the language of the user.'};
  while (messages.length) {
    const prompt = await engine.formatChat([system,...messages],true);
    if ((await engine.tokenize(prompt)).length + answerTokens + 2 <= contextSize) return prompt;
    messages.splice(0,2);
  }
}
el('chat').onsubmit = async event => {
  event.preventDefault();
  const content = el('question').value.trim();
  if (!content || !engine || operation) return;
  const user = {role:'user',content};
  const file = el('doc').files[0];
  const controller = new AbortController();
  busy(controller);
  status(w.thinking);
  let response, reply = '';
  try {
    if (file) {
      if (file.size > 16384 || !/\.(?:txt|md|csv)$/i.test(file.name)) return status(w.docInvalid);
      let text;
      try { text = new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()); }
      catch { return status(w.docInvalid); }
      if (!text.trim() || text.includes('\0')) return status(w.docInvalid);
      user.content += '\n\n'+file.name+'\n'+text;
    }
    const exact = !file ? calculate(content,language) : null;
    if (exact !== null) {
      el('question').value = '';
      bubble('user',content);
      reply = exact;
      bubble('assistant',reply);
      return status(w.calculated);
    }
    const prompt = await promptFor(user);
    if (!prompt) return status(w.long);
    controller.signal.throwIfAborted();
    el('question').value = '';
    bubble('user',user.content);
    response = bubble('assistant','');
    reply = await engine.createCompletion(prompt,{nPredict:answerTokens,useCache:true,sampling:{temp:0.15},abortSignal:controller.signal,onNewToken:(_id,_piece,text)=>{
      reply = text;
      const container = el('conversation');
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 48;
      response.textContent = text;
      if (atBottom) container.scrollTop = container.scrollHeight;
    }});
    response.textContent = reply;
    status(controller.signal.aborted ? w.stopped : w.ready);
  } catch {
    status(controller.signal.aborted ? w.stopped : w.error);
    if (!reply) el('question').value = content;
  } finally {
    if (reply) {
      if (file) removeDocument();
      history.push(user,{role:'assistant',content:reply});
      if (history.length > 40) history.splice(0,2);
    } else if (response) response.parentElement.remove();
    busy(null);
    el('question').focus();
  }
};

el('export-chat').onclick = () => {
  const lines = Array.from(el('conversation').children,item=>item.querySelector('strong').textContent+'\n'+item.querySelector('p').textContent);
  const url = URL.createObjectURL(new Blob([lines.join('\n\n')],{type:'text/plain;charset=utf-8'}));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'StartupBot-'+new Date().toISOString().slice(0,10)+'.txt';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
