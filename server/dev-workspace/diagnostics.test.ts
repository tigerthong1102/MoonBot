import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { expect, it } from "vitest";
import { run } from "./command.ts";
import { recordAttempt } from "./attempts.ts";
import { analyzeTypeScriptSource, diagnoseAttempt } from "./diagnostics.ts";

it("attaches new and preexisting TypeScript diagnostics to an active revision", async () => {
  const root = mkdtempSync(join(tmpdir(), "attempt-diagnostics-"));
  try {
    run("git", ["init"], root);
    const source = "export const old: number = 'old';\n";
    const project = join(root, "nested");
    mkdirSync(project);
    writeFileSync(join(project, "demo.ts"), source);
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "commonjs" } }));
    writeFileSync(join(root, "base.json"), JSON.stringify({ compilerOptions: { noImplicitAny: false } }));
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({ extends: "../base.json", include: ["*.ts"] }));
    writeFileSync(join(project, "host.d.ts"), "declare const fixtureHost: { price: number };");
    run("git", ["add", "."], root);
    run("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "seed"], root);
    recordAttempt(root, "start", { host: "one" });
    const changes = [
      "export const newer: string = 123;",
      "export const valid: number = fixtureHost.price;",
      "export const moduleUrl = import.meta.url;",
      "export function fromConfig(value) { return value; }",
    ];
    writeFileSync(join(project, "demo.ts"), source + changes.join("\n"));
    const result = await diagnoseAttempt(root, 1, "one", "nested/demo.ts");
    expect(result.diagnostics).toMatchObject([{ code: 2322, line: 1, status: "existing" }, { code: 2322, line: 2, status: "new" }]);
    expect(recordAttempt(root, "show", {})).toMatchObject({ attempts: [{ diagnostics: [result] }] });
    recordAttempt(root, "finish", { host: "one", attempt: 1, exit: 0 });
    await expect(diagnoseAttempt(root, 1, "one", "nested/demo.ts")).rejects.toThrow("attempt");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("uses the supplied revision when the language service normalizes the source path", async () => {
  const { default: ts } = await import("@typescript/typescript6");
  const root = mkdtempSync(join(tmpdir(), "diagnostic-overlay-"));
  try {
    const file = join(root, "demo.ts");
    writeFileSync(file, "export const changed: number = 'new';");
    const sourcePath = [root, ".", "demo.ts"].join(sep);
    const previous = analyzeTypeScriptSource(ts, sourcePath, "export const changed: number = 1;", { options: {}, directory: root, fileNames: [file] });
    expect(previous).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
