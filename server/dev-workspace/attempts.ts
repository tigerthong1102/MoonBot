import { basename, dirname } from "node:path";
import { watch } from "node:fs/promises";
import { mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { VerbContext } from "../headless/context.ts";
import { EXIT } from "../headless/args.ts";
import { run, commitOf, publishFile } from "./command.ts";

export function recordAttempt(repo: string, action: string, args: { host?: string; retry?: boolean; attempt?: number; exit?: number; artifact?: string }) {
  const state = join(run("git", ["rev-parse", "--absolute-git-dir"], repo).trim(), "startupbot-attempts");
  if (!existsSync(state) && action === "show") return { attempts: [] };
  mkdirSync(state, { recursive: true, mode: 0o700 });
  const sequence = () => readdirSync(state).filter(n => /^[1-9]\d*\.json$/.test(n)).map(n => Number(n.split(".")[0])).sort((a,b) => a-b);
  const read = (file: string) => JSON.parse(readFileSync(join(state, file), "utf8"));
  const ids = sequence();
  const last = ids.at(-1) ?? 0;
  if (action === "show") return { attempts: ids.map(n => ({ ...read(n + ".json"), diagnostics: readdirSync(state).filter(name => name.startsWith(n + ".diagnostics.")).sort().map(read), result: existsSync(join(state, n + ".result")) ? read(n + ".result") : null })) };
  if (action === "start") {
    if (!args.host?.trim() || args.host.length > 200) throw new Error("Identify the worker host.");
    if (last && !existsSync(join(state, last + ".result"))) {
      if (!args.retry) throw new Error("A worker attempt is active. Use --retry to explicitly supersede it.");
      // A finishing worker and a retry contend for the same immutable result.
      publishFile(join(state, last + ".result"), JSON.stringify({ attempt: last, superseded: true, finishedAt: new Date().toISOString() }));
    }
    const receipt = { attempt: last + 1, host: args.host, head: commitOf(repo, "HEAD"), startedAt: new Date().toISOString() };
    if (!publishFile(join(state, receipt.attempt + ".json"), JSON.stringify(receipt))) throw new Error("Another worker already started this attempt.");
    return receipt;
  }
  if (action !== "finish" || !last || last !== args.attempt || !Number.isInteger(args.exit) || args.exit! < 0 || args.exit! > 255) throw new Error("Finish the current attempt with --attempt N and --exit 0–255.");
  const active = read(last + ".json");
  if (active.host !== args.host || active.head !== commitOf(repo, "HEAD")) throw new Error("The attempt host or checked-out revision changed.");
  const file = last + ".result";
  const receipt = { attempt: last, host: args.host, head: active.head, exit: args.exit, artifact: args.artifact || null, finishedAt: new Date().toISOString() };
  if (!publishFile(join(state, file), JSON.stringify(receipt))) {
    const existing = read(file);
    if (existing.exit === args.exit && existing.artifact === (args.artifact || null)) return existing;
    throw new Error("This worker attempt already has a different result.");
  }
  return receipt;
}

export async function attemptCommand(ctx: VerbContext) {
  const repo = resolve(String(ctx.flags.repo || "."));
  if (ctx.positionals[0] === "diagnose") {
    const { diagnoseAttempt } = await import("./diagnostics.ts");
    const file = String(ctx.flags.file || "");
    const read = () => diagnoseAttempt(repo, Number(ctx.flags.attempt), String(ctx.flags.host || ""), file);
    let result = read();
    if (ctx.flags.watch === true) {
      ctx.output.progress(result);
      for await (const event of watch(dirname(resolve(repo, file)), { signal: ctx.signal })) {
        if (event.filename && event.filename !== basename(file)) continue;
        const next = read();
        if (next.sourceSha256 !== result.sourceSha256) ctx.output.progress(next);
        result = next;
      }
    }
    return { result, exitCode: EXIT.done, human: [JSON.stringify(result, null, 2)] };
  }
  const result = recordAttempt(repo, ctx.positionals[0] || "show", { host: typeof ctx.flags.host === "string" ? ctx.flags.host : undefined,
    retry: ctx.flags.retry === true, attempt: Number(ctx.flags.attempt), exit: Number(ctx.flags.exit), artifact: typeof ctx.flags.artifact === "string" ? ctx.flags.artifact : undefined });
  return { result, exitCode: EXIT.done, human: [JSON.stringify(result, null, 2)] };
}
