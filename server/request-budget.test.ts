import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createRequestBudgets } from "./request-budget.ts";

const folders: string[] = [];
afterEach(() => { for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function factory() {
  const directory = mkdtempSync(join(tmpdir(), "request-budget-"));
  folders.push(directory);
  const root = { id: "request", bot: "lead" };
  let linked = false;
  const open = createRequestBudgets({ directory, activeRoots: () => new Set([root.id]),
    config: () => ({ usageCaps: { stops: "everything", run: { tokens: 100 }, server: { dailyTokens: 150 } } }) });
  return { open, root, parent: open("lead", true, () => linked ? root : undefined), link: () => { linked = true; } };
}

it("shares measured usage across delegated work and carries pre-delegation usage into the root", () => {
  const { open, root, parent, link } = factory();
  parent.before(); parent.record(40, 0); link();
  const child = open("child", true, () => root);
  child.before(); child.record(60, 0); child.finish();
  expect(parent.before).toThrow(/cap/);
  expect(open("child2", true, () => root).before).toThrow(/cap/);
  parent.finish();
  expect(open("lead", true, () => ({ ...root, id: "next" })).before).not.toThrow();
});

it("counts concurrent unfinished turns at server scope", () => {
  const { open } = factory();
  const a = open("a", true, () => undefined), b = open("b", true, () => undefined);
  a.record(80, 0); b.record(70, 0);
  expect(open("c", true, () => undefined).before).toThrow(/cap/);
});
