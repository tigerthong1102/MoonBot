import assert from "node:assert/strict";

export async function smokeWindowsQuit({ inspect, evaluate, expectedPid }) {
  const deadline = Date.now() + 20_000;
  let target;
  while (!target && Date.now() < deadline) {
    try { target = (await fetch(`http://127.0.0.1:${inspect}/json/list`, { signal: AbortSignal.timeout(2_000) }).then(response => response.json()))[0]; } catch {}
    if (!target) await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(target?.webSocketDebuggerUrl, "The fixture main inspector must be available");
  const inspector = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { inspector.addEventListener("open", resolve, { once: true }); inspector.addEventListener("error", reject, { once: true }); });
  try {
    let next = 0;
    const main = expression => new Promise((resolve, reject) => {
      const id = ++next, timer = setTimeout(() => { inspector.removeEventListener("message", receive); reject(new Error("Main inspector timed out")); }, 10_000);
      const receive = event => { const frame = JSON.parse(String(event.data)); if (frame.id !== id) return; clearTimeout(timer); inspector.removeEventListener("message", receive); if (frame.error || frame.result?.exceptionDetails) reject(new Error(frame.error?.message ?? frame.result.exceptionDetails.text)); else resolve(frame.result?.result?.value); };
      inspector.addEventListener("message", receive); inspector.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
    });
    assert.equal(await main("process.pid"), expectedPid, "The inspector must belong to the fixture application");
    await main(`(()=>{const e=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron');const original=e.Tray.prototype.setContextMenu;e.Tray.prototype.setContextMenu=function(menu){if(menu?.items?.some(item=>item.label==='Quit StartupBot')&&menu.items.some(item=>item.label==='Open StartupBot'))globalThis.__fixtureQuitMenu=menu;return original.call(this,menu)};return true})()`);
    await evaluate("window.ogb.desktopLanguage.set('vi')");
    await evaluate("window.ogb.desktopLanguage.set('en')");
    assert.equal(await main("Boolean(globalThis.__fixtureQuitMenu?.items.find(item=>item.label==='Quit StartupBot'))"), true, "The native tray Quit action must be available");
    const origin = await evaluate("location.origin");
    assert.equal(await main(`(()=>{const windows=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron').BrowserWindow.getAllWindows();const win=windows.find(candidate=>candidate.webContents.getURL().startsWith(${JSON.stringify(origin + "/")}));if(!win)return false;win.close();return !win.isDestroyed()&&!win.isVisible()})()`), true, "Closing the fixture window must leave the tray application running");
    await main("(()=>{const item=globalThis.__fixtureQuitMenu.items.find(entry=>entry.label==='Quit StartupBot');setTimeout(()=>item.click(item,null,{}),10);return true})()");
  } finally { inspector.close(); }
}
