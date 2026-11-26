import { expect, it, vi } from "vitest";

import { guardedExecutors } from "./guarded-executors.ts";
import type { StepExecutors } from "./runner.ts";

it("does not execute a workflow action until it is allowed and approved", async () => {
  const app = vi.fn(async () => ({ ok: true as const, output: "sent" }));
  const original: StepExecutors = {
    app, shell: async () => ({ ok: true, output: "" }), browser: async () => ({ ok: true, output: "" }), file: async () => ({ ok: true, output: "" }),
  };
  let allowed = false;
  let approved = false;
  const exec = guardedExecutors(original, { allowed: () => allowed, approve: async () => approved });
  const input = { app: "gmail", tool: "GMAIL_SEND_EMAIL", args: { to: "fixture@example.invalid" }, signal: new AbortController().signal, maxBytes: 1000 };
  expect(await exec.app(input)).toMatchObject({ ok: false });
  allowed = true;
  expect(await exec.app(input)).toMatchObject({ ok: false });
  approved = true;
  expect(await exec.app(input)).toMatchObject({ ok: true });
  expect(app).toHaveBeenCalledTimes(1);
});

it("checks authorization again after approval and refuses oversized action details", async () => {
  const shell = vi.fn(async () => ({ ok: true as const, output: "" }));
  const original: StepExecutors = { shell, app: async () => ({ ok: true, output: "" }), browser: async () => ({ ok: true, output: "" }), file: async () => ({ ok: true, output: "" }) };
  let allowed = true;
  const approve = vi.fn(async () => { allowed = false; return true; });
  const exec = guardedExecutors(original, { allowed: () => allowed, approve });
  const input = { command: "echo fixture", env: {}, where: "bot" as const, tool: "shell", signal: new AbortController().signal, maxBytes: 1000 };
  expect(await exec.shell(input)).toMatchObject({ ok: false });
  expect(shell).not.toHaveBeenCalled();
  allowed = true;
  expect(await exec.shell({ ...input, command: "a".repeat(5_000) })).toMatchObject({ ok: false });
  expect(approve).toHaveBeenCalledTimes(1);
  expect(shell).not.toHaveBeenCalled();
});
