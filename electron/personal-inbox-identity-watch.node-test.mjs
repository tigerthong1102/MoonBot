import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { watchInboxIdentities } from "./personal-inbox-identity-watch.mjs";

test("keeps only one identity-only watcher on a local window and stops it on navigation or close", () => {
  const win = new EventEmitter(), web = new EventEmitter();
  let local = true, starts = 0, stops = 0;
  win.webContents = web; win.isDestroyed = () => false;
  web.getURL = () => "http://127.0.0.1:4000"; web.isLoadingMainFrame = () => false;
  watchInboxIdentities({ win, origin: () => "https://fixture.invalid", isLocal: () => local, inboxSession: () => ({}), localRequest: () => {}, locale: () => "en",
    startBots: (_win, page, _origin, _request, _language, options) => { starts++; assert.equal(options.identityOnly, true); page.once("destroyed", () => { assert.equal(page.isDestroyed(), true); stops++; }); return {}; } });
  assert.equal(starts, 1);
  web.emit("did-start-navigation", {}, "http://127.0.0.1:4000/#in-page", true, true); assert.equal(stops, 0);
  web.emit("did-start-navigation", {}, "https://fixture.invalid", false, false); assert.equal(stops, 0);
  web.emit("did-start-navigation", {}, "https://fixture.invalid", false, true); assert.equal(stops, 1);
  assert.equal(starts, 1);
  web.emit("did-finish-load"); assert.equal(starts, 2); assert.equal(stops, 1);
  local = false; web.emit("did-finish-load"); assert.equal(starts, 2); assert.equal(stops, 2);
  local = true; web.emit("did-finish-load"); assert.equal(starts, 3);
  win.emit("closed"); assert.equal(stops, 3);
  assert.equal(web.listenerCount("did-start-navigation"), 0);
  assert.equal(web.listenerCount("did-finish-load"), 0);
});
