import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";

export async function smokeGroupUsernames({ bot, evaluate, until, cdp, evidence }) {
  assert.match(bot.id, /^[0-9a-f-]{36}$/);
  const username = `bot_u${bot.id.replaceAll("-", "")}`;
  await until(() => evaluate("Boolean(document.querySelector('button[aria-label=\"New or share\"]'))"), "the new menu");
  await evaluate("document.querySelector('button[aria-label=\"New or share\"]').click()");
  await until(() => evaluate("[...document.querySelectorAll('[role=menuitem]')].some(el => el.textContent.includes('New group chat'))"), "the new group entry");
  await evaluate("[...document.querySelectorAll('[role=menuitem]')].find(el => el.textContent.includes('New group chat')).click()");
  await until(() => evaluate("Boolean(document.querySelector('[role=dialog] input[type=search]'))"), "the group bot search");
  const search = JSON.stringify(`@${username}`);
  await evaluate(`(() => { const input = document.querySelector('[role=dialog] input[type=search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${search}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const chosen = `[...document.querySelectorAll('[role=dialog] [role=checkbox]')].find(el => el.getAttribute('aria-label')?.endsWith(${search}))`;
  await until(() => evaluate(`Boolean(${chosen})`), "the bot matched by username");
  assert.equal(await evaluate("document.querySelectorAll('[role=dialog] [role=checkbox]').length"), 1);
  await evaluate(`${chosen}.click()`);
  assert.equal(await evaluate(`${chosen}.getAttribute('aria-checked')`), "true");
  const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(evidence, "group-username.png"), Buffer.from(screenshot.data, "base64"));
  await evaluate(`(() => { const original = window.fetch; window.__groupFixtureFetch = original; window.fetch = async (...args) => { const response = await original.call(window, ...args); if (args[0] === '/api/groups' && args[1]?.method === 'POST') window.__groupFixtureResult = { status: response.status, body: await response.clone().json() }; return response; }; })()`);
  await evaluate("document.querySelector('[role=dialog] button[type=submit]').click()");
  await until(() => evaluate("!document.querySelector('[role=dialog] input[type=search]')"), "group creation to finish");
  const result = await until(() => evaluate("window.__groupFixtureResult"), "the group creation response");
  await evaluate("window.fetch = window.__groupFixtureFetch; delete window.__groupFixtureFetch; delete window.__groupFixtureResult");
  assert(result.status >= 200 && result.status < 300, `Group creation failed: ${result.status}`);
  assert.deepEqual(result.body.group.memberIds, [bot.id], "The username must select the correct bot identity");
}
