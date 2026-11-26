import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { appFrame, createExecutors, shellQuote } from "./executors.ts";
import { engineHomes } from "../engine-homes/engine-homes.ts";
import { audienceHome } from "../engine-homes/layout.ts";

const folder = () => mkdtempSync(join(tmpdir(), "burger-exec-"));
const signal = () => new AbortController().signal;

describe("where a Skill Burger's steps run", () => {
  it.skipIf(process.platform === "win32")("uses each conversation's isolated engine home for saved shell commands", async () => {
    const root = folder();
    const home = join(root, "server-home");
    const dataDir = join(root, "data");
    mkdirSync(home, { recursive: true });
    engineHomes.start({ dataDir, serverHome: home, audienceOf: (id) => id === "bob" ? "member:p_bob" : "team", threads: () => [], log: () => {} });
    try {
      const internal = async () => ({ ok: false, body: {} });
      const run = (threadId?: string) => createExecutors({ botId: "b", threadId, cwd: root, internal }).shell({ command: 'printf %s "$HOME"', env: {}, where: "bot", tool: "shell", signal: signal(), maxBytes: 1_000 });
      expect(await run("bob")).toEqual({ ok: true, output: audienceHome(dataDir, "member:p_bob") });
      expect(await run("team")).toEqual({ ok: true, output: audienceHome(dataDir, "team") });
      expect(await run()).toMatchObject({ ok: false });
    } finally { engineHomes.stop(); }
  });
  it("opens a saved browser address using the supported MCP tool", async () => {
    let called: unknown;
    const exec = createExecutors({ botId: "b", cwd: folder(), internal: async (_kind, _path, body) => { called = body; return { ok: true, body: { result: { content: [{ type: "text", text: "opened" }] } } }; } });
    expect(await exec.browser({ url: "https://example.test", signal: signal() })).toMatchObject({ ok: true });
    expect(called).toMatchObject({ params: { name: "agent_browser_open", arguments: { url: "https://example.test" } } });
  });
  it("sends an app action through the one multi-execute tool, and a plain app tool by its own name", () => {
    expect(appFrame("GMAIL_SEND_EMAIL", { to: "a" }, "acct-1", 7).frame).toEqual({
      jsonrpc: "2.0", id: 7, method: "tools/call",
      params: { name: "COMPOSIO_MULTI_EXECUTE_TOOL", arguments: { tools: [{ tool_slug: "GMAIL_SEND_EMAIL", arguments: { to: "a" }, account: "acct-1" }] } },
    });
    expect(appFrame("gmail.search_emails", { query: "invoice" }, undefined, 8).slug).toMatch(/^GMAIL_/);
  });

  it("writes a file only inside the conversation's folder", async () => {
    const cwd = folder();
    const exec = createExecutors({ botId: "b", cwd, internal: async () => ({ ok: false, body: {} }) });
    expect(await exec.file({ path: "notes/a.md", content: "hi", signal: signal() })).toMatchObject({ ok: true });
    expect(readFileSync(join(cwd, "notes/a.md"), "utf8")).toBe("hi");
    expect(await exec.file({ path: "../escape.md", content: "x", signal: signal() })).toMatchObject({ ok: false });
    symlinkSync(tmpdir(), join(cwd, "out"), "junction");
    expect(await exec.file({ path: "out/escape.md", content: "x", signal: signal() })).toMatchObject({ ok: false });
  });

  it("refuses to follow a final symlink to a file outside the conversation", async (context) => {
    const cwd = folder();
    const outside = join(folder(), "outside.txt");
    writeFileSync(outside, "original");
    try { symlinkSync(outside, join(cwd, "linked.txt")); }
    catch (error) { if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") context.skip(); else throw error; }
    const exec = createExecutors({ botId: "b", cwd, internal: async () => ({ ok: false, body: {} }) });
    expect(await exec.file({ path: "linked.txt", content: "modified", signal: signal() })).toMatchObject({ ok: false });
    expect(readFileSync(outside, "utf8")).toBe("original");
  });

  it("does not create parent directories outside the conversation through a symlink", async () => {
    const cwd = folder();
    const outside = folder();
    symlinkSync(outside, join(cwd, "linked"), "junction");
    const exec = createExecutors({ botId: "b", cwd, internal: async () => ({ ok: false, body: {} }) });
    expect(await exec.file({ path: "linked/new/report.txt", content: "data", signal: signal() })).toMatchObject({ ok: false });
    expect(existsSync(join(outside, "new"))).toBe(false);
  });

  it("does not retry a cloud command through another route after an ambiguous failure", async () => {
    const paths: string[] = [];
    const exec = createExecutors({ botId: "b", cwd: folder(), internal: async (_kind, path) => {
      paths.push(path);
      return { ok: false, status: 503, body: { error: "connection lost" } };
    } });
    const result = await exec.shell({ command: "send invoice", env: {}, where: "vm", tool: "shell", signal: signal(), maxBytes: 1_000 });
    expect(result).toMatchObject({ ok: false });
    expect(paths).toEqual(["/api/internal/vm-exec"]);
  });

  it("refuses a VM Bash command when the interpreter cannot be guaranteed", async () => {
    const paths: string[] = [];
    const exec = createExecutors({ botId: "b", cwd: folder(), internal: async (_kind, path) => {
      paths.push(path);
      return { ok: true, body: {} };
    } });
    expect(await exec.shell({ command: "printf '%s\\n' {north,south}", shell: "bash", env: {}, where: "vm", tool: "vm", signal: signal(), maxBytes: 1_000 })).toMatchObject({ ok: false });
    expect(paths).toEqual([]);
  });

  it("does not treat failed app responses as successful calls", async () => {
    for (const body of [
      { successful: false, error: "denied" },
      { successful: true, data: { results: [{ tool_slug: "GMAIL_SEND_EMAIL", response: { successful: false, error: "denied" } }] } },
    ]) {
      const exec = createExecutors({ botId: "b", cwd: folder(), internal: async () => ({ ok: true, body: { result: { content: [{ type: "text", text: JSON.stringify(body) }] } } }) });
      expect(await exec.app({ tool: "GMAIL_SEND_EMAIL", app: "gmail", args: {}, signal: signal(), maxBytes: 10_000 })).toMatchObject({ ok: false, error: "denied" });
    }
  });

  it("retains response wrappers used by references in recorded workflows", async () => {
    const body = { successful: true, data: { results: [{ tool_slug: "GMAIL_FETCH_EMAILS", response: { successful: true, data: { messages: [{ id: "fixture" }] } } }] } };
    const exec = createExecutors({ botId: "b", cwd: folder(), internal: async () => ({ ok: true, body: { result: { content: [{ type: "text", text: JSON.stringify(body) }] } } }) });
    expect(await exec.app({ tool: "GMAIL_FETCH_EMAILS", app: "gmail", args: {}, signal: signal(), maxBytes: 10_000 })).toEqual({ ok: true, output: body });
  });

  it("returns the unwrapped data captured for plain app tools", async () => {
    const body = { successful: true, data: { results: [{ tool_slug: "GMAIL_FETCH_EMAILS", response: { successful: true, data: { messages: [{ messageId: "fixture" }] } } }] } };
    const exec = createExecutors({ botId: "b", cwd: folder(), internal: async () => ({ ok: true, body: { result: { content: [{ type: "text", text: JSON.stringify(body) }] } } }) });
    expect(await exec.app({ tool: "gmail.search_emails", app: "gmail", args: { query: "invoice" }, signal: signal(), maxBytes: 10_000 })).toEqual({ ok: true, output: { messages: [{ messageId: "fixture" }] } });
  });

  it("preserves the message from a JSON-RPC error", async () => {
    const exec = createExecutors({ botId: "b", cwd: folder(), internal: async () => ({ ok: false, body: { error: { code: -32000, message: "Account disconnected" } } }) });
    expect(await exec.app({ tool: "GMAIL_SEND_EMAIL", app: "gmail", args: {}, signal: signal(), maxBytes: 1_000 })).toEqual({ ok: false, error: "Account disconnected" });
    expect(await exec.browser({ url: "https://example.test", signal: signal() })).toEqual({ ok: false, error: "Account disconnected" });
  });

  it.skipIf(process.platform === "win32")("resolves the working folder inside the conversation and rejects paths outside it", async () => {
    const cwd = folder();
    mkdirSync(join(cwd, "child"));
    const exec = createExecutors({ botId: "b", cwd, internal: async () => ({ ok: false, body: {} }) });
    const input = { command: "pwd", env: {}, where: "bot" as const, tool: "shell", signal: signal(), maxBytes: 1_000 };
    expect(await exec.shell({ ...input, cwd: "child" })).toMatchObject({ ok: true, output: expect.stringContaining("/child") });
    expect(await exec.shell({ ...input, cwd: tmpdir() })).toMatchObject({ ok: false, error: expect.stringContaining("outside") });
  });

  it.skipIf(process.platform === "win32")("stops a command's descendants on cancellation", async () => {
    const cwd = folder();
    const exec = createExecutors({ botId: "b", cwd, internal: async () => ({ ok: false, body: {} }) });
    const controller = new AbortController();
    const running = exec.shell({ command: "touch started; (sleep 0.5; printf persisted > marker) & wait", env: {}, where: "bot", tool: "shell", signal: controller.signal, maxBytes: 1_000 });
    const startedBy = Date.now() + 5_000;
    while (!existsSync(join(cwd, "started")) && Date.now() < startedBy) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(existsSync(join(cwd, "started"))).toBe(true);
    controller.abort();
    expect(await running).toMatchObject({ ok: false });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(existsSync(join(cwd, "marker"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")("runs a command as the bot, reading its inputs from OMB_ARG_ variables, and stops one that says too much", async () => {
    const cwd = folder();
    const exec = createExecutors({ botId: "b", cwd, internal: async () => ({ ok: false, body: {} }) });
    const value = "it's $(rm -rf /) `x`";
    const ran = await exec.shell({ command: 'printf %s "$OMB_ARG_NOTE"', env: { OMB_ARG_NOTE: value }, where: "bot", tool: "shell", signal: signal(), maxBytes: 1_000 });
    expect(ran).toEqual({ ok: true, output: value });
    expect(await exec.shell({ command: "exit 3", env: {}, where: "bot", tool: "shell", signal: signal(), maxBytes: 1_000 })).toMatchObject({ ok: false });
    expect(await exec.shell({ command: "yes | head -c 5000", env: {}, where: "bot", tool: "shell", signal: signal(), maxBytes: 1_000 })).toMatchObject({ ok: false, tooLarge: true });
    expect(shellQuote(value)).toBe(`'it'\\''s $(rm -rf /) \`x\`'`);
  });

  it.skipIf(process.platform === "win32")("uses Bash for a recorded Bash command", async () => {
    const exec = createExecutors({ botId: "b", cwd: folder(), internal: async () => ({ ok: false, body: {} }) });
    const result = await exec.shell({ command: "printf '%s\\n' {north,south}", shell: "bash", env: {}, where: "bot", tool: "shell", signal: signal(), maxBytes: 1_000 });
    expect(result).toEqual({ ok: true, output: "north\nsouth\n" });
  });
});
