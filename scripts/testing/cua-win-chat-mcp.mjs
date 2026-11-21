import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ChatMcpClient } from "../../server/drivers/chat-mcp-tools.ts";

assert.equal(process.env.FAKE_CLAUDE_WINDOWS_NAVIGATION_FIXTURE, "1");
const { server, calls } = JSON.parse(readFileSync(0, "utf8"));
assert.equal(typeof server.command, "string");
assert.ok(server.env?.OMB_CONTROL_URL && server.env?.OMB_CONTROL_TOKEN && Array.isArray(server.args));
assert.ok(calls.every(call => call.server === "computer"));
assert.deepEqual(calls.map(call => call.name), ["list_apps", "list_windows", "get_window_state", "click", "get_window_state"]);
const before = calls[2].input, click = calls[3].input, after = calls[4].input;
assert.deepEqual(before, after);
assert.deepEqual(click, { pid: before.pid, window_id: before.window_id, element_token: "$fixture.navigationButton", delivery_mode: "background" });
assert.ok(Number.isSafeInteger(before.pid) && Number.isSafeInteger(before.window_id));
assert.equal(before.tree_format, "elements");
assert.equal(before.include_screenshot, false);

const client = new ChatMcpClient({ command: server.command, args: server.args, env: server.env }, true);
const signal = AbortSignal.timeout(12_000);
try {
  await client.tools(signal);
  const replies = [];
  let token;
  for (const [index, { name, input: scripted }] of calls.entries()) {
    if (index === 3) assert.match(token, /^s[0-9a-f]{8}:\d+$/);
    const input = index === 3 ? { ...scripted, element_token: token } : scripted;
    const result = await client.call("tools/call", { name, arguments: input }, signal);
    assert.ok(result && result.isError !== true && !result.structuredContent?.refusal, "production computer gate or native driver refused " + name);
    if (index === 2) {
      const state = result.structuredContent;
      assert.equal(state.pid, before.pid);
      assert.equal(state.window_id, before.window_id);
      assert.equal(state.elements_complete, true);
      const buttons = state.elements.filter(row => row.role === "Button" && row.label === "Navigate fixture" && row.enabled === true);
      assert.equal(buttons.length, 1);
      token = buttons[0].element_token;
    }
    replies.push({ ok: true, input, content: result.content });
  }
  process.stdout.write(JSON.stringify(replies));
} finally {
  await client.close();
}
