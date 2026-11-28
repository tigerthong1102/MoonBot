module.exports = async function verifyGenerated({ d, b, mobile, cfg, until, delay, BrowserWindow, assert }) {
  const js = (w, expression) => w.webContents.executeJavaScript(expression);
  await until(d, '!!document.querySelector("[data-generated-release]")');
  await js(d, 'document.querySelector("[data-generated-release] summary").click()');
  await js(d, 'document.querySelector("[data-generated-release] fieldset button").click()');
  await until(d, '!!document.querySelector("[data-generated-release] select")');
  assert((await js(d, 'document.querySelector("[data-generated-release]").textContent')).includes(cfg.endpoint));
  if (cfg.ongoing) {
    assert.equal(await js(d, 'document.querySelector("[data-duration]").value'), "once");
    await js(d, '(()=>{const select=document.querySelector("[data-duration]");select.value="online";select.dispatchEvent(new Event("change",{bubbles:true}));})()');
    await until(d, 'document.querySelector("[data-generated-release] input[type=number]")?.value==="5"');
  }
  if (cfg.future) {
    await js(d, '(()=>{const scope=document.querySelector("[data-generated-release] select");scope.value="all";scope.dispatchEvent(new Event("change",{bubbles:true}));})()');
  } else {
    await js(d, 'document.querySelector("[data-generated-release] input").click()');
  }
  await js(d, 'Array.from(document.querySelectorAll("[data-generated-release] fieldset button")).find(b=>b.textContent.includes("Request Inbox approval")).click()');
  await until(d, 'document.querySelector("[data-generated-release] [role=status]").textContent.includes("another Inbox")');
  await js(b, 'document.querySelector("#twin-generated summary").click()');
  await until(b, 'document.querySelectorAll("#generated-terms button").length===2');
  const terms = await js(b, 'document.querySelector("#twin-generated").textContent');
  const scopes=cfg.future ? await js(b,'import("/inbox-i18n.js").then(({t})=>[t("personalInbox.generatedAllDirect"),t("personalInbox.generatedAllGroups")])') : [cfg.room];
  for (const value of [cfg.endpoint,"fixture-model",...scopes,cfg.origin]) assert(terms.includes(value), value);
  if (cfg.ongoing) {
    const scopeTerms = await js(b, 'import("/inbox-i18n.js").then(({t})=>t("personalInbox.generatedOngoingTerms",{count:5}))');
    assert(terms.includes(scopeTerms));
  }
  await js(b, 'document.querySelectorAll("#generated-terms button")[1].click()');
  await until(b, 'document.querySelectorAll("#generated-terms button").length===1');
  if (cfg.future) {
    const body=JSON.stringify({id:cfg.room,kind:"direct",email:"peer@example.test",instant:true});
    assert.equal(await js(b, 'fetch("/api/rooms",{method:"POST",headers:{"content-type":"application/json"},body:'+JSON.stringify(body)+'}).then(r=>r.status)'),200);
  }
  const peer = new BrowserWindow({show:false,webPreferences:{partition:"temporary-generated-peer",contextIsolation:true,sandbox:true}});
  try {
    await peer.webContents.session.cookies.set({url:cfg.origin,...cfg.cookies[3],path:"/",secure:true,httpOnly:true});
    await peer.loadURL(cfg.origin);
    const selector = JSON.stringify('button[data-room="'+cfg.room+'"]');
    await until(peer, '!!document.querySelector('+selector+')');
    await js(peer, 'document.querySelector('+selector+').click()');
    await until(peer, '!document.querySelector("#generated-notice").hidden && !document.querySelector("#compose").hidden');
    assert((await js(peer,'document.querySelector("#generated-notice").textContent')).includes(cfg.endpoint));
    async function send() {
      await js(peer, '(()=>{const f=document.querySelector("#draft");f.value='+JSON.stringify(cfg.question)+';f.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#compose").requestSubmit();})()');
      await until(peer,'document.querySelector("#draft").value===""');
    }
    const read = '(async()=>(await(await fetch("/api/rooms/'+cfg.room+'")).json()).posts.filter(p=>p.generatedReply).map(p=>p.body))()';
    await send();
    await until(peer, '('+read+').then(rows=>rows.length===1)');
    assert.deepEqual(await js(peer,read),[cfg.answer]);
    await js(peer, 'document.querySelector('+selector+').click()');
    const visibleReply = 'Array.from(document.querySelectorAll("#posts [data-seq]")).find(post => post.textContent.includes('+
      JSON.stringify(cfg.answer)+'))';
    const attribution = await js(peer, 'import("/inbox-i18n.js").then(({t})=>t("personalInbox.generatedAttribution",{owner:"owner@example.test"}))');
    await until(peer, '('+visibleReply+')?.querySelector("small")?.textContent.includes('+JSON.stringify(attribution)+')');
    const expected = [cfg.answer];
    if (cfg.renewalCycle) {
      const status = () => js(b, '(async()=>(await(await fetch("/api/twin-generated")).json()).grant)()');
      const first = await status();
      assert.equal(first.dailyLimit,5);
      await delay(Math.max(0,first.expires - Date.now()) + 1800);
      const renewed = await status();
      assert.equal(renewed.id,first.id);
      assert(renewed.expires>first.expires && renewed.expires>Date.now());
      await send();
      expected.push(cfg.answer);
      await until(peer, '('+read+').then(rows=>rows.length===2)');
      assert.deepEqual(await js(peer,read),expected);
    }
    await js(mobile,'document.querySelector("#twin-generated summary").click()');
    await until(mobile,'document.querySelectorAll("#generated-terms button").length===1');
    if (cfg.ongoing && !cfg.renewalCycle) {
      d.once("close", event => event.preventDefault());
      d.close();
      assert(!d.isDestroyed());
    } else {
      await js(mobile,'document.querySelector("#generated-terms button").click()');
    }
    await until(mobile,'(async()=>!(await(await fetch("/api/twin-generated")).json()).grant)()');
    await send(); await delay(2500);
    assert.deepEqual(await js(peer,read),expected);
    console.log("PASS: "+(cfg.future ? "future DM created after both approvals" : "selected DM")+", visible sender notice, "+expected.length+" provider answer(s), revocation read back from an independent session.");
  } finally { peer.destroy(); }
};
