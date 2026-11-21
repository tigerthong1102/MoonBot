import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ChatMcpClient } from "../../server/drivers/chat-mcp-tools.ts";
import { fixtureSnapshot } from "../cua-win-qualification.mjs";

const TOOLS = ["list_apps", "list_windows", "get_window_state", "click", "get_window_state"];

async function record() {
  let phase = "config";
  let client;
  try {
    assert.equal(process.env.FAKE_CLAUDE_WINDOWS_NAVIGATION_FIXTURE, "1");
    const { server, calls } = JSON.parse(readFileSync(0, "utf8"));
    assert.equal(typeof server.command, "string");
    assert.ok(server.env?.OMB_CONTROL_URL && server.env?.OMB_CONTROL_TOKEN && Array.isArray(server.args));
    assert.ok(calls.every(call => call.server === "computer"));
    assert.deepEqual(calls.map(call => call.name), TOOLS);
    const before = calls[2].input, click = calls[3].input, after = calls[4].input;
    assert.deepEqual(before, after);
    assert.deepEqual(click, { pid: before.pid, window_id: before.window_id, element_token: "$fixture.navigationButton", delivery_mode: "background" });
    assert.ok(Number.isSafeInteger(before.pid) && Number.isSafeInteger(before.window_id));
    assert.equal(before.tree_format, "elements");
    assert.equal(before.include_screenshot, false);

    phase = "initialize";
    client = new ChatMcpClient({ command: server.command, args: server.args, env: server.env }, true);
    const budgetMs = 12_000;
    const deadline = performance.now() + budgetMs;
    const signal = AbortSignal.timeout(budgetMs);
    const catalog = await client.tools(signal);
    for (const name of new Set(TOOLS)) assert.equal(catalog.filter(tool => tool.name === name).length, 1);
    const replies = [];
    let token;
    for (const [index, { name, input: scripted }] of calls.entries()) {
      phase = ["list_apps", "list_windows", "snapshot_before", "click", "snapshot_after"][index];
      const input = index === 3 ? { ...scripted, element_token: token } : scripted;
      const timeout = Math.max(1, Math.ceil(deadline - performance.now()));
      const result = await client.call("tools/call", { name, arguments: input }, signal, timeout);
      if (!result) return { issue: phase + ":empty-response" };
      if (result.structuredContent?.refusal) return { issue: phase + ":refused" };
      if (result.isError === true) return { issue: phase + ":tool-error" };
      if (index === 2) token = fixtureSnapshot(result, before).token;
      if (index === 4) fixtureSnapshot(result, after);
      replies.push({ ok: true, input, content: result.content });
    }
    return { replies };
  } catch (error) {
    // No real output, command, paths, or credential values leave this isolated worker on failure.
    const reason = error?.code === "ERR_ASSERTION" ? "invalid-fixture-contract"
      : error?.message?.includes("timed out") ? "timeout"
      : error?.message === "MCP operation cancelled" ? "cancelled"
      : error?.message?.startsWith("MCP server could not start") ? "launch"
      : error?.message?.startsWith("MCP server exited") ? "transport-closed"
      : error?.message?.startsWith("MCP request failed") ? "rpc-rejected" : "unexpected-error";
    return { issue: phase + ":" + reason };
  } finally {
    await client?.close();
  }
}

process.stdout.write(JSON.stringify(await record()));
