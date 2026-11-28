module.exports = async function verifyGenerated({ d, b, mobile, cfg, until, delay, BrowserWindow, assert }) {
  const js = (w, expression) => w.webContents.executeJavaScript(expression);
  await until(d, '!!document.querySelector("[data-generated-release]")');
  await js(d, 'document.querySelector("[data-generated-release] summary").click()');
  await js(d, 'document.querySelector("[data-generated-release] fieldset button").click()');
  await until(d, '!!document.querySelector("[data-generated-release] input[type=checkbox]")');
  assert((await js(d, 'document.querySelector("[data-generated-release]").textContent')).includes(cfg.endpoint));
  await js(d, 'document.querySelector("[data-generated-release] input").click()');
  await js(d, 'Array.from(document.querySelectorAll("[data-generated-release] fieldset button")).find(b=>b.textContent.includes("Request Inbox approval")).click()');
  await until(d, 'document.querySelector("[data-generated-release] [role=status]").textContent.includes("another Inbox")');
  await js(b, 'document.querySelector("#twin-generated summary").click()');
  await until(b, 'document.querySelectorAll("#generated-terms button").length===2');
  const terms = await js(b, 'document.querySelector("#twin-generated").textContent');
  for (const value of [cfg.endpoint,"fixture-model",cfg.room,cfg.origin]) assert(terms.includes(value), value);
  await js(b, 'document.querySelectorAll("#generated-terms button")[1].click()');
  await until(b, 'document.querySelectorAll("#generated-terms button").length===1');
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
    await js(mobile,'document.querySelector("#twin-generated summary").click()');
    await until(mobile,'document.querySelectorAll("#generated-terms button").length===1');
    await js(mobile,'document.querySelector("#generated-terms button").click()');
    await until(mobile,'(async()=>!(await(await fetch("/api/twin-generated")).json()).grant)()');
    await send(); await delay(2500);
    assert.deepEqual(await js(peer,read),[cfg.answer]);
    console.log("PASS: selected DM and provider in both approvals, visible sender notice, one provider answer posted, independent revocation read back.");
  } finally { peer.destroy(); }
};
