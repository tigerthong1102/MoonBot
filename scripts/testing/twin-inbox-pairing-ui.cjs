const { app, BrowserWindow, session, ipcMain, dialog } = require("electron");
const { readFileSync } = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const cfg = JSON.parse(readFileSync(process.argv.at(-1), "utf8"));
assert.equal(new URL(cfg.origin).hostname, "127.0.0.1");
assert.equal(new URL(cfg.local).hostname, "127.0.0.1");
assert.equal(new URL(cfg.desktopOrigin).hostname, "127.0.0.1");
process.env.STARTUPBOT_INBOX_ORIGIN = cfg.origin;
app.setPath("userData", path.join(cfg.scratch, "ui-profile"));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(win, js) {
  for (let i = 0; i < 120; i++) {
    const found = await win.webContents.executeJavaScript(js);
    if (found) return found;
    await delay(80);
  }
  const diagnose = await win.webContents.executeJavaScript(
    `JSON.stringify({lang:document.documentElement.lang,status:document.querySelector("#twin-pair-status")?.textContent,active:document.querySelectorAll("#twin-pair-active li").length,open:document.querySelector("#twin-pairing")?.open})`,
  );
  throw Error("UI timed out: " + js + " " + diagnose);
}
app
  .whenReady()
  .then(async () => {
    const { createPersonalInbox } = await import(path.join(cfg.root, "electron/personal-inbox-view.mjs"));
    const local = require(path.join(cfg.root, "electron/local-origin.cjs"));
    local.setLocalOrigin(cfg.desktopOrigin);
    const d = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(cfg.root, "electron/preload.cjs"),
        contextIsolation: true,
        sandbox: true,
        additionalArguments: ["--startupbot-personal-inbox", "--omb-local-origin=" + cfg.desktopOrigin],
      },
    });
    const b = new BrowserWindow({
      show: false,
      webPreferences: { partition: "temporary-review", contextIsolation: true, sandbox: true },
    });
    const mobile = new BrowserWindow({
      show: false,
      webPreferences: { partition: "temporary-revoke", contextIsolation: true, sandbox: true },
    });
    for (const [i, s] of [
      session.fromPartition("persist:startupbot-personal-inbox"),
      b.webContents.session,
      mobile.webContents.session,
    ].entries()) {
      await s.cookies.set({ url: cfg.origin, ...cfg.cookies[i], path: "/", secure: true, httpOnly: true });
    }
    const runtime = {};

    let expectedFingerprint,
      dialogs = 0;
    dialog.showMessageBox = async (w, opts) => {
      assert.equal(w, d);
      if (dialogs === 0) {
        assert.ok(opts.detail.includes(expectedFingerprint));
        assert.ok(opts.message.includes("fingerprint"));
      } else if (cfg.generated) {
        for (const field of [cfg.endpoint, "fixture-model", ...(cfg.future ? ["All current and future accepted direct messages","All current and future groups I own or manage"] : [cfg.room]), cfg.origin, "5", "charges", ...(cfg.ongoing ? ["automatically renews", "5 per rolling 24 hours", "in-flight"] : [])]) assert.ok(opts.detail.includes(field), field);
      } else {
        assert.ok(cfg.exact);
        for (const field of [cfg.question, cfg.answer, cfg.room, cfg.origin])
          assert.ok(opts.detail.includes(field));
        assert.ok(opts.message.includes("20 replies"));
        assert.ok(opts.detail.includes("30-day"));
      }
      assert.equal(opts.defaultId, 0);
      assert.equal(opts.buttons[0], "Cancel");
      dialogs++;
      return { response: 1 };
    };
    for (const name of [
      "update:offered",
      "home:page",
      "home:updating",
      "desktop-analytics:read",
      "desktop-language:read",
    ])
      ipcMain.on(name, (e) => {
        e.returnValue = null;
      });
    createPersonalInbox({
      window: () => d,
      locale: () => "en",
      languageKey: () => "en",
      isLocal: () => local.isLocalSender({ sender: d.webContents }),
      localRuntime: () => runtime,
      translate: require(path.join(cfg.root, "electron/native-text.cjs")).createNativeText({
        saved: "en",
        system: () => "en",
      }).t,
      localRequest: (p, init) =>
        fetch(cfg.local + p, { ...init, headers: { ...init?.headers, "x-openmausbot-desktop-owner": cfg.ownerToken } }),
    }).install(ipcMain, local.localOnly, (e) => {
      assert.equal(e.sender, d.webContents);
      assert.equal(e.senderFrame, e.sender.mainFrame);
    });
    await Promise.all([d.loadURL(cfg.desktopOrigin), b.loadURL(cfg.origin), mobile.loadURL(cfg.origin)]);
    await until(d, 'document.querySelector("summary")?.textContent');
    await until(b, 'document.getElementById("inbox")?.hidden === false');
    await until(mobile, 'document.getElementById("inbox")?.hidden === false');
    await d.webContents.executeJavaScript(
      'document.querySelector("summary").click();document.querySelector("details button").click()',
    );
    const code = await until(d, 'document.querySelector("details label code")?.textContent');
    expectedFingerprint = await d.webContents.executeJavaScript(
      'document.querySelectorAll("details label code")[1].textContent',
    );
    await b.webContents.executeJavaScript('document.querySelector("#twin-pairing summary").click()');
    await delay(100);
    await b.webContents.executeJavaScript(
      'document.querySelector("#twin-pair-form input").value=' +
        JSON.stringify(code) +
        ';document.querySelector("#twin-pair-form").requestSubmit()',
    );
    assert.equal(
      await until(b, 'document.getElementById("twin-pair-fingerprint").textContent'),
      expectedFingerprint,
    );
    await d.webContents.executeJavaScript('document.querySelectorAll("details button")[1].click()');
    await until(
      d,
      '[...document.querySelectorAll("[role=status]")].some(x=>x.textContent.includes("Desktop confirmed"))',
    );
    assert.equal(dialogs, 1);
    await b.webContents.executeJavaScript('document.getElementById("twin-pair-confirm").click()');
    await until(b, 'document.querySelector("#twin-pair-active li")?.textContent');
    if (cfg.generated) {
      await require("./twin-generated-ui.cjs")({ d, b, mobile, cfg, until, delay, BrowserWindow, assert });
    }
    if (cfg.exact) {
      await b.webContents.executeJavaScript(
        "const exactRealNow=Date.now; Date.now=()=>exactRealNow()+86400000;void 0;",
      );
      await mobile.webContents.executeJavaScript(
        "const exactRealNow=Date.now; Date.now=()=>exactRealNow()-86400000;void 0;",
      );
      await d.webContents.executeJavaScript('document.querySelector("details details summary").click()');
      await until(d, '!document.querySelector("details details button")?.disabled');
      await d.webContents.executeJavaScript('document.querySelector("details details button").click()');
      await until(d, 'document.querySelector("details select option:nth-child(2)")?.value');
      await d.webContents.executeJavaScript(
        '(()=>{const s=document.querySelector("details select");s.selectedIndex=1;s.dispatchEvent(new Event("change",{bubbles:true}));document.querySelectorAll("details input[type=checkbox]")[1].click()})()',
      );
      await until(d, '!document.querySelector("details fieldset button").disabled');
      await d.webContents.executeJavaScript('document.querySelector("details fieldset button").click()');
      await until(
        d,
        'document.querySelector("details details [role=status]").textContent.includes("Awaiting approval")',
      );
      assert.equal(dialogs, 2);
      await b.webContents.executeJavaScript('document.querySelector("#twin-exact summary").click()');
      await until(b, 'document.querySelectorAll("#exact-terms button").length===2');
      const terms = await b.webContents.executeJavaScript('document.querySelector("#exact-terms").textContent');
      for (const field of [cfg.question, cfg.answer, cfg.room, cfg.origin]) assert.ok(terms.includes(field));
      assert.ok(
        (
          await b.webContents.executeJavaScript(
            'document.querySelector("#twin-exact [data-i18n$=exactRetention]").textContent',
          )
        ).includes("30"),
      );
      await b.webContents.executeJavaScript('document.querySelectorAll("#exact-terms button")[1].click()');
      await until(
        b,
        'document.querySelectorAll("#exact-terms button").length===1 && /approved|đã duyệt/i.test(document.querySelector("#exact-status").textContent)',
      );
      const peer = session.fromPartition("temporary-peer");
      await peer.cookies.set({ url: cfg.origin, ...cfg.cookies[3], path: "/", secure: true, httpOnly: true });
      const post = async (body) =>
        assert.equal(
          (
            await peer.fetch(cfg.origin + "/api/rooms/" + cfg.room + "/posts", {
              credentials: "include",
              method: "POST",
              headers: { origin: cfg.origin, "content-type": "application/json" },
              body: JSON.stringify({ kind: "text", body, nonce: require("node:crypto").randomUUID() }),
            })
          ).status,
          200,
        );
      const reads =
        "(async()=>{const v=await(await fetch(" +
        JSON.stringify("/api/rooms/" + cfg.room) +
        ")).json();return v.posts.filter(p=>p.exactReply).map(p=>p.body)})()";
      await post("unmatched fixture");
      await post(cfg.question);
      await until(b, "(async()=>(await " + reads + ").length===1)()");
      assert.deepEqual(await b.webContents.executeJavaScript(reads), [cfg.answer]);
      await mobile.webContents.executeJavaScript('document.querySelector("#twin-exact summary").click()');
      await until(mobile, 'document.querySelector("#exact-terms button")?.textContent');
      await mobile.webContents.executeJavaScript('document.querySelector("#exact-terms button").click()');
      await until(
        mobile,
        'document.querySelectorAll("#exact-terms button").length===0 && /no active|không có quyền/i.test(document.querySelector("#exact-status").textContent)',
      );
      await post(cfg.question);
      await delay(2000);
      assert.deepEqual(await b.webContents.executeJavaScript(reads), [cfg.answer]);
      await d.webContents.executeJavaScript('document.querySelector("details fieldset button").click()');
      await until(b, '(async()=>!!(await(await fetch("/api/twin-exact")).json()).grant)()');
      const account = session.fromPartition("persist:startupbot-personal-inbox");
      account.webRequest.onBeforeRequest({ urls: [cfg.origin + "/*"] }, (_details, reply) =>
        reply({ cancel: true }),
      );
      await d.loadURL(cfg.desktopOrigin);
      await until(d, 'document.querySelector("summary")?.textContent');
      await d.webContents.executeJavaScript('document.querySelector("summary").click()');
      await until(d, 'document.querySelector("details details summary")?.textContent');
      await d.webContents.executeJavaScript('document.querySelector("details details summary").click()');
      await until(
        d,
        'document.querySelector("details details [role=status]").textContent.includes("Local signing stopped")',
      );
      account.webRequest.onBeforeRequest(null);
      await d.webContents.executeJavaScript(
        'Array.from(document.querySelectorAll("details details button")).find(b=>b.textContent.includes("Check Inbox status")).click()',
      );
      await until(d, 'document.querySelector("details details [role=status]").textContent.includes("no active")');
      assert.equal(
        await b.webContents.executeJavaScript('(async()=>(await(await fetch("/api/twin-exact")).json()).grant)()'),
        null,
      );
      console.log(
        "PASS: explicit native-dialog arguments, reviewed answer and selected DM, one actual online reply, independent revocation with readback.",
      );
    }
    await mobile.webContents.executeJavaScript('document.querySelector("#twin-pairing summary").click()');
    await until(mobile, 'document.querySelector("#twin-pair-active button")?.textContent');
    await mobile.webContents.executeJavaScript('document.querySelector("#twin-pair-active button").click()');
    await delay(500);
    console.log(
      "Revoke receipt",
      await mobile.webContents.executeJavaScript(
        'JSON.stringify({lang:document.documentElement.lang,status:document.getElementById("twin-pair-status").textContent,remaining:document.querySelectorAll("#twin-pair-active li").length})',
      ),
    );
    await until(mobile, 'document.querySelector("#twin-pair-active li") === null');
    await b.webContents.executeJavaScript('window.dispatchEvent(new Event("focus"))');
    await until(b, 'document.querySelector("#twin-pair-active li") === null');
    const final = await b.webContents.executeJavaScript(
      '(async()=>({pairs:(await(await fetch("/api/twin-pairing")).json()).pairings.length,gate:(await fetch("/api/twin-auto-reply")).status}))()',
    );
    assert.deepEqual(final, { pairs: 0, gate: 404 });
    d.destroy();
    b.destroy();
    mobile.destroy();
    app.exit(0);
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
