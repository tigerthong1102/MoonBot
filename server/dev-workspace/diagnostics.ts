import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type ts from "@typescript/typescript6";
import { commitOf, publishFile, run } from "./command.ts";

type Issue = { code: number; line: number; column: number; message: string };
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

function analyze(ts: typeof import("@typescript/typescript6"), file: string, content: string, options: ts.CompilerOptions, root: string, files: string[]): Issue[] {
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => files,
    getScriptVersion: () => "1",
    getScriptSnapshot: name => {
      const data = name === file ? content : ts.sys.readFile(name);
      return data === undefined ? undefined : ts.ScriptSnapshot.fromString(data);
    },
    getCurrentDirectory: () => root,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
  };
  const service = ts.createLanguageService(host);
  try {
    return [...service.getSyntacticDiagnostics(file), ...service.getSemanticDiagnostics(file)].map(issue => {
      const position = issue.file?.getLineAndCharacterOfPosition(issue.start ?? 0);
      return { code: issue.code, line: (position?.line ?? 0) + 1, column: (position?.character ?? 0) + 1, message: ts.flattenDiagnosticMessageText(issue.messageText, "\n") };
    });
  } finally { service.dispose(); }
}

export async function diagnoseAttempt(repo: string, attempt: number, host: string, input: string) {
  const { default: ts } = await import("@typescript/typescript6");
  if (!Number.isSafeInteger(attempt) || attempt < 1 || !host || !input) throw new Error("Identify the active attempt, worker host and TypeScript file.");
  const root = realpathSync(run("git", ["rev-parse", "--show-toplevel"], repo).trim());
  const state = join(run("git", ["rev-parse", "--absolute-git-dir"], root).trim(), "startupbot-attempts");
  const active = JSON.parse(readFileSync(join(state, attempt + ".json"), "utf8"));
  const file = realpathSync(resolve(root, input));
  const path = relative(root, file);
  if (!path || isAbsolute(path) || path === ".." || path.startsWith(".." + sep) || !/\.(?:[mc]?ts|tsx)$/i.test(path)) throw new Error("Choose a TypeScript file inside this checkout.");
  if (!statSync(file).isFile() || statSync(file).size > 1024 * 1024) throw new Error("Choose a source file of at most 1 MiB.");
  const assertActive = () => {
    if (active.attempt !== attempt || active.host !== host || active.head !== commitOf(root, "HEAD") || existsSync(join(state, attempt + ".result"))) throw new Error("The worker attempt or checked-out revision has changed.");
  };
  assertActive();
  const original = run("git", ["--literal-pathspecs", "ls-tree", "-z", active.head, "--", path], root);
  const oid = /^100(?:644|755) blob ([a-f\d]+)\t/.exec(original)?.[1];
  if (original && !oid) throw new Error("The baseline is not a regular file.");
  const before = oid ? run("git", ["cat-file", "blob", oid], root) : "";
  const source = readFileSync(file, "utf8");
  const config = ts.findConfigFile(dirname(file), name => !relative(root, name).startsWith(".." + sep) && ts.sys.fileExists(name));
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, strict: true };
  let files = [file];
  if (config) {
    const parsed = ts.readConfigFile(config, ts.sys.readFile);
    if (parsed.error) throw new Error("Cannot read the project's TypeScript configuration.");
    const settings = ts.parseJsonConfigFileContent(parsed.config, ts.sys, dirname(config), undefined, config);
    const invalid = settings.errors.filter(error => error.code !== 18003);
    if (invalid.length) throw new Error("Invalid TypeScript options: " + ts.flattenDiagnosticMessageText(invalid[0]!.messageText, "\n"));
    Object.assign(options, settings.options);
    files = [...new Set([...settings.fileNames, file])];
  }
  const previous = analyze(ts, file, before, options, root, files);
  const key = (issue: Issue) => JSON.stringify([issue.code, issue.message]);
  const counts = new Map<string, number>();
  for (const issue of previous) counts.set(key(issue), (counts.get(key(issue)) ?? 0) + 1);
  const diagnostics = analyze(ts, file, source, options, root, files).map(issue => {
    const remaining = counts.get(key(issue)) ?? 0;
    if (remaining) counts.set(key(issue), remaining - 1);
    return { ...issue, status: remaining ? "existing" : "new" };
  });
  assertActive();
  if (source !== readFileSync(file, "utf8")) throw new Error("The source changed during diagnostics.");
  const evidence = { attempt, head: active.head, path, sourceSha256: digest(source), languageService: ts.version, diagnostics };
  publishFile(join(state, attempt + ".diagnostics." + digest(JSON.stringify(evidence)) + ".json"), JSON.stringify(evidence));
  return evidence;
}
