import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { VerbContext } from "../headless/context.ts";
import { EXIT } from "../headless/args.ts";
import { publishFile, run } from "./command.ts";

interface GitHubEvent {
  repository?: { full_name?: string };
  workflow_run?: { id?: number; head_sha?: string; run_attempt?: number };
  check_run?: { id?: number; head_sha?: string };
  pull_request?: { id?: number; head?: { sha?: string } };
}

export function eventIdentity(event: GitHubEvent) {
  const repo = event.repository?.full_name;
  const kind = event.workflow_run ? "workflow_run" : event.check_run ? "check_run" : "pull_request";
  const item = event.workflow_run || event.check_run || event.pull_request;
  const head = event.workflow_run?.head_sha ?? event.check_run?.head_sha ?? event.pull_request?.head?.sha;
  const attempt = event.workflow_run?.run_attempt ?? 1;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !Number.isSafeInteger(item?.id) || item!.id! <= 0 || !head || !/^[0-9a-f]{40}$/i.test(head) || !Number.isSafeInteger(attempt) || attempt < 1) throw new Error("The event must identify the GitHub repository, source, revision and attempt.");
  return { repo, head, kind, id: item!.id!, attempt };
}

export async function ciEventCommand(ctx: VerbContext) {
  const eventFile = String(ctx.flags.event || ""), output = String(ctx.flags.out || "");
  const number = Number(ctx.flags.pr);
  if (!eventFile || !output || !Number.isSafeInteger(number) || number < 1) throw new Error("Choose --event FILE, --pr NUMBER and --out FILE.");
  if (statSync(eventFile).size > 2 * 1024 * 1024) throw new Error("The event payload exceeds 2 MiB.");
  const identity = eventIdentity(JSON.parse(readFileSync(eventFile, "utf8")));
  if (identity.repo.toLowerCase() !== String(ctx.flags.github || "").toLowerCase()) throw new Error("Event repository differs from --github.");
  const cwd = resolve(String(ctx.flags.repo || "."));
  const current = () => JSON.parse(run("gh", ["pr", "view", String(number), "--repo", identity.repo, "--json", "headRefOid,url"], cwd));
  const pr = current();
  if (pr.headRefOid !== identity.head) throw new Error("This event belongs to a prior PR revision.");
  const source = identity.kind === "workflow_run" ? "actions/runs/" + identity.id : identity.kind === "check_run" ? "check-runs/" + identity.id : "pulls/" + number;
  const eventUrl = "repos/" + identity.repo + "/" + source;
  const record = JSON.parse(run("gh", ["api", eventUrl], cwd));
  if (record.id !== identity.id || (record.head_sha ?? record.head?.sha) !== identity.head || (record.run_attempt ?? 1) !== identity.attempt) throw new Error("GitHub has a different source or a newer run attempt.");
  if (current().headRefOid !== identity.head) throw new Error("The PR revision changed while reading the event.");
  const key = [identity.repo, number, identity.kind, identity.id, identity.head, identity.attempt].join("/");
  const text = [key, "", "Review CI for " + pr.url, "Revision " + identity.head, "Source " + (record.html_url ?? record.details_url ?? pr.url),
    "Attempt " + identity.attempt, "Status " + (record.conclusion || record.status || record.state)].join("\n") + "\n";
  const reused = !publishFile(output, text);
  if (reused) {
    const prior = readFileSync(output, "utf8");
    const status = prior.lastIndexOf("\nStatus ");
    const sameDraft = status >= 0 && prior.slice(0, status) === text.slice(0, text.lastIndexOf("\nStatus "))
      && /^\nStatus [a-z_]+\n$/i.test(prior.slice(status));
    if (!sameDraft) throw new Error("The output path contains a different draft.");
  }
  return { result: { key, output: resolve(output), reused }, exitCode: EXIT.done, human: [resolve(output)] };
}
