export function webPage(t) {
  const w = t.web;
  return `<section class="webapp"><div class="webhead"><img src="/mark.png" alt="" width="52" height="52"><div><h1>${w.title}</h1><p>${w.subtitle}</p></div></div>
  <section class="workspace work-connect"><div><h2>${w.workspace}</h2><p>${w.hostHelp}</p></div><form id="workspace"><label for="host">${w.address}</label><div class="host-line"><input type="url" id="host" placeholder="https://…" required autocomplete="off" spellcheck="false"><button type="submit" class="button">${w.open}</button></div>
  <label class="checkline"><input type="checkbox" id="remember-host"> ${w.rememberHost}</label><p id="host-error" role="alert"></p></form></section>
  <details class="workspace math-tool"><summary>${w.mathTitle}</summary><form id="calculator"><label for="expression">${w.mathHelp}</label><div class="host-line"><input id="expression" type="text" maxlength="220" required placeholder="1250000 × 8%" autocomplete="off"><button class="button">${w.calc}</button></div><output id="calc-result" for="expression" aria-live="polite"></output></form></details>
  <section class="chatbox"><div id="start-panel"><h2>${w.startTitle}</h2><label for="model">${w.model}</label><select id="model"><option value="quality">${w.quality}</option><option value="compact">${w.compact}</option></select><p id="consent">${w.consent}</p><button class="button" id="load-model" type="button">${w.start}</button></div>
  <fieldset id="copies-panel" hidden><legend>${w.copies}</legend><select id="copies" aria-label="${w.copies}"></select><button type="button" class="textbutton" id="open-copy">${w.restore}</button><button type="button" class="textbutton" id="delete-copy">${w.deleteCopy}</button></fieldset>
  <div class="webstatus"><span role="status" id="status"></span><progress id="progress" hidden max="100"></progress></div>
  <section id="conversation" aria-label="${w.dialog}"></section>
  <form id="chat" hidden><label for="question">${w.prompt}</label><textarea id="question" maxlength="6000" rows="3" required></textarea>
  <details class="attachment"><summary>${w.document}</summary><label for="doc">${w.docHelp}</label><input type="file" id="doc" accept=".txt,.md,.csv,text/plain,text/markdown,text/csv"><button hidden type="button" id="remove-doc" class="textbutton">${w.removeDoc}</button></details>
  <div class="chat-actions"><button type="button" class="textbutton" id="clear">${w.clear}</button><button type="button" class="textbutton" id="save-copy" disabled>${w.saveCopy}</button><button type="button" class="textbutton" id="export-chat" disabled>${w.export}</button><button class="button" id="send">${w.send}</button></div></form>
  <button type="button" class="textbutton" id="stop" hidden>${w.stop}</button>
  <noscript>${w.noScript}</noscript><details class="chat-privacy"><summary>${w.data}</summary><p>${w.privacy}</p><a class="guide-link" href="/web/notices.txt">${w.credits}</a></details>
  </section></section><script type="application/json" id="messages">${JSON.stringify(w).replaceAll('<','\\u003c')}</script><script type="module" src="/web/chat.js"></script>`;
}
