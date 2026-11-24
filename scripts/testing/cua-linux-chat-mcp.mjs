import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ChatMcpClient } from "../../server/drivers/chat-mcp-tools.ts";

let client;
try {
  assert.equal(process.env.FAKE_CLAUDE_LINUX_NAVIGATION_FIXTURE, "1");
  const { server, calls } = JSON.parse(readFileSync(0, "utf8"));
  assert.ok(server.env?.OMB_CONTROL_URL && server.env?.OMB_CONTROL_TOKEN);
  assert.equal(server.env.OMB_COMPUTER_JOURNAL, "1");
  const names = calls.map(call => call.name);
  assert.deepEqual(names, calls.length === 7
    ? ["list_apps", "list_windows", "get_window_state", "click", "get_window_state", "click", "get_window_state"]
    : ["list_apps", "list_windows", "get_window_state", "click", "get_window_state"]);
  client = new ChatMcpClient({ command: server.command, args: server.args, env: server.env }, true);
  const signal = AbortSignal.timeout(25000);
  await client.tools(signal);
  const replies = [];
  let token;
  for (const [index, call] of calls.entries()) {
    const input = call.name === "click" ? { ...call.input, element_token: token } : call.input;
    const result = await client.call("tools/call", { name: call.name, arguments: input }, signal, 20000);
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent?.refusal, undefined);
    if (call.name === "get_window_state" && index < calls.length - 1) {
      const tree = result.structuredContent;
      assert.equal(tree.elements_complete, true);
      const expected = calls.length === 7 && index === 2 ? "Reports" : "Open report";
      const buttons = tree.elements.filter(row => row.role === "push button" && row.label === expected && row.enabled === true);
      assert.equal(buttons.length, 1);
      token = buttons[0].element_token;
      assert.equal(typeof token, "string");
    }
    if (index === calls.length - 1) assert.equal(result.structuredContent?.window_title, "StartupBot Linux destination");
    replies.push({ ok: true, input, content: result.content });
  }
  process.stdout.write(JSON.stringify({ replies }));
} catch (error) {
  process.stdout.write(JSON.stringify({ issue: "fixture:" + (error?.code === "ERR_ASSERTION" ? "invalid-contract" : "failed") }));
} finally {
  await client?.close();
}


