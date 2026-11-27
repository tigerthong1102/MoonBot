import type { snapshot } from "./review.ts";
import type { readPull } from "./github.ts";
const html = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const link = (url: string, label: string) => /^https:\/\//.test(url) ? '<a rel="noreferrer" href="' + html(url) + '">' + html(label) + '</a>' : html(label);

export function renderReview(review: ReturnType<typeof snapshot>, pr: ReturnType<typeof readPull> | null) {
  const files = review.files.map(({ path, lines, truncated }) => `<details open><summary>${html(path)}</summary><div class="code">${lines.map(row =>
    `<button class="line ${row.text.startsWith("+") ? "add" : row.text.startsWith("-") ? "del" : ""}" data-file="${html(path)}" data-side="${row.side}" data-line="${row.line}" title="Add review note"><span>${row.side === "LEFT" ? "−" : "+"}${row.line}</span><code>${html(row.text)}</code></button>`
  ).join("")}</div>${truncated ? "<p>Preview limit reached.</p>" : !lines.length ? "<p>File metadata or binary change.</p>" : ""}</details>`).join("");
  const checks = pr ? pr.checks.map((c: { url: string; name: string; status: string }) => '<li>' + link(c.url, c.name) + ' · ' + html(c.status) + '</li>').join("") : "";
  const threads = pr ? pr.threads.map((thread: { resolved: boolean; outdated: boolean; path: string; line: number | null; url: string }) =>
    '<li>' + link(thread.url, thread.path + (thread.line ? ':' + thread.line : '')) + ' · ' + (thread.resolved ? 'Resolved' : 'Open') + (thread.outdated ? ' · Outdated' : '') + '</li>').join("") : "";
  const comments = pr ? pr.comments.map((c: { url: string; path: string; line: unknown; body: string; revision: string; context?: string }) =>
    '<article>' + link(c.url, c.path + (c.line ? ":" + c.line : "")) + ' · ' + html(c.revision.slice(0, 12)) + '<p>' + html(c.body) + '</p><pre>' + html(c.context || "") + '</pre></article>').join("") : "";
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>StartupBot · Code review</title><link rel="icon" href="data:,">
<style>*{box-sizing:border-box}body{max-width:88rem;margin:auto;padding:2rem;color:#202c2a;font:16px/1.5 Inter,system-ui,sans-serif}h1{line-height:1.2}details,article{margin:.8rem 0;border:1px solid #bccac5;border-radius:6px;padding:.7rem}summary{font-weight:600;cursor:pointer}.code{overflow:auto}.line{display:flex;text-align:left;min-width:100%;width:max-content;border:0;background:white;cursor:pointer;white-space:pre;padding:0 .4rem}.line span{width:5rem;color:#556;flex-shrink:0}.line.add{background:#e9f7ed}.line.del{background:#ffecea}.line:focus{outline:2px solid #315d88;outline-offset:-2px}textarea{width:100%;min-height:6rem}pre,p{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#165941}dialog{width:min(90vw,35rem)}button{font:inherit}.line{font:14px/1.6 monospace}code{font:inherit}</style>
<h1>${pr ? link(pr.url, "#" + pr.number + " " + pr.title) : "Code review"}</h1><p>${html(review.base.slice(0, 12))} → ${html(review.head.slice(0, 12))} · ${review.files.length} files</p>
${checks ? '<details><summary>CI checks</summary><ul>' + checks + '</ul></details>' : ""}
${threads ? '<details><summary>Review threads</summary><ul>' + threads + '</ul></details>' : ""}
${comments ? '<details><summary>GitHub review comments</summary>' + comments + '</details>' : ""}
<p>Choose a line to write a note. Export notes to paste into a StartupBot draft.</p>
<button id="export" disabled>Export review notes</button><span id="count" role="status"></span>${files}
<dialog id="note"><form method="dialog"><p id="where"></p><textarea id="text" aria-label="Review note"></textarea><button value="save">Save note</button> <button value="cancel">Cancel</button></form></dialog>
<script>
const head='${review.head}', base='${review.base}', key='startupbot-review-'+base+'-'+head;
const notes=new Map(); try{for(const pair of JSON.parse(localStorage.getItem(key)||'[]'))notes.set(pair[0],pair[1]);}catch{}
const modal=document.getElementById('note'), field=document.getElementById('text'), output=document.getElementById('export');
let selected=null;
function refresh(){output.disabled=!notes.size; document.getElementById('count').textContent=' · '+notes.size+' notes';}
document.addEventListener('click',e=>{const row=e.target.closest('button.line'); if(!row)return; selected=[row.dataset.file,row.dataset.side,row.dataset.line];
document.getElementById('where').textContent=selected.join(' · ');field.value=notes.get(JSON.stringify(selected))||'';modal.returnValue='';modal.showModal();field.focus();});
modal.addEventListener('close',()=>{if(modal.returnValue!=='save'||!selected)return;const k=JSON.stringify(selected); if(field.value.trim())notes.set(k,field.value.trim());else notes.delete(k);
try{localStorage.setItem(key,JSON.stringify([...notes]));}catch{}refresh();});
output.onclick=()=>{const body=['Review '+head,'Base '+base,'',...[...notes].map(([k,v])=>JSON.parse(k).join(' · ')+'\\n'+v+'\\n')].join('\\n');const url=URL.createObjectURL(new Blob([body],{type:'text/markdown'}));
const a=document.createElement('a');a.href=url;a.download='review-'+head.slice(0,12)+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}; refresh();</script></html>`;
}
