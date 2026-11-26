import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";

export async function smokeGroupUsernames({ bot, duplicate, evaluate, until, cdp, evidence }) {
  assert.match(bot.id, /^[0-9a-f-]{36}$/);
  assert.match(duplicate.id, /^[0-9a-f-]{36}$/);
  await until(() => evaluate("Boolean(document.querySelector('button[aria-label=\"New or share\"]'))"), "the new menu");
  await evaluate("document.querySelector('button[aria-label=\"New or share\"]').click()");
  await until(() => evaluate("[...document.querySelectorAll('[role=menuitem]')].some(el => el.textContent.includes('New group chat'))"), "the new group entry");
  await evaluate("[...document.querySelectorAll('[role=menuitem]')].find(el => el.textContent.includes('New group chat')).click()");
  await until(() => evaluate("Boolean(document.querySelector('[role=dialog] input[type=search]'))"), "the group bot search");
  await until(() => evaluate(`[...document.querySelectorAll('[role=dialog] [role=checkbox]')].filter(el => el.getAttribute('aria-label') === ${JSON.stringify(bot.name)}).length === 2`), "the synthetic bots to load");
  const labels = await evaluate("[...document.querySelectorAll('[role=dialog] [role=checkbox]')].map(el => el.getAttribute('aria-label'))");
  assert.equal(labels.filter(label => label === bot.name).length, 2, "Both unregistered bots must appear under their real names");
  assert(!labels.some(label => /@bot_[uxk]/.test(label ?? "")), "Unregistered bots must not show a fabricated username");
  const fake = JSON.stringify(`@bot_u${bot.id.replaceAll("-", "")}`);
  await evaluate(`(() => { const input = document.querySelector('[role=dialog] input[type=search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${fake}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await until(() => evaluate("document.querySelectorAll('[role=dialog] [role=checkbox]').length === 0"), "a fabricated username to produce no results");
  const search = JSON.stringify(bot.name);
  await evaluate(`(() => { const input = document.querySelector('[role=dialog] input[type=search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${search}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const chosen = `[...document.querySelectorAll('[role=dialog] [role=checkbox]')].find(el => el.getAttribute('aria-label') === ${search})`;
  await until(() => evaluate(`document.querySelectorAll('[role=dialog] [role=checkbox]').length === 2 && Boolean(${chosen})`), "both bots matched by their name");
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
  assert.equal(result.body.group.memberIds.length, 1, "Exactly one bot must be selected");
  assert([bot.id, duplicate.id].includes(result.body.group.memberIds[0]), "The selected member must be one of the synthetic bots");
  writeFileSync(path.join(evidence, "group-username-status.json"), JSON.stringify({ registeredUsername: "not tested: fixture bots are unregistered", fabricatedUsernameVisible: false, selectedSyntheticBot: true }) + "\n");
  return { groupId: result.body.group.id, botId: result.body.group.memberIds[0] };
}
