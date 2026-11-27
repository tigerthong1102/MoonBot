import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { run } from "./command.ts";
import { recordAttempt } from "./attempts.ts";
import { diagnoseAttempt } from "./diagnostics.ts";

it("attaches new and preexisting TypeScript diagnostics to an active revision", async () => {
  const root = mkdtempSync(join(tmpdir(), "attempt-diagnostics-"));
  try {
    run("git", ["init"], root);
    const source = "export const old: number = 'old';\n";
    writeFileSync(join(root, "demo.ts"), source);
    run("git", ["add", "demo.ts"], root);
    run("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "seed"], root);
    recordAttempt(root, "start", { host: "one" });
    writeFileSync(join(root, "demo.ts"), source + "export const newer: string = 123;\n");
    const result = await diagnoseAttempt(root, 1, "one", "demo.ts");
    expect(result.diagnostics).toMatchObject([{ code: 2322, line: 1, status: "existing" }, { code: 2322, line: 2, status: "new" }]);
    expect(recordAttempt(root, "show", {})).toMatchObject({ attempts: [{ diagnostics: [result] }] });
    recordAttempt(root, "finish", { host: "one", attempt: 1, exit: 0 });
    await expect(diagnoseAttempt(root, 1, "one", "demo.ts")).rejects.toThrow("attempt");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
