import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Only an unambiguous open PR in this repository can own a CI draft. */
export function selectEventPull(event, knownPulls) {
  const target = event.repository?.full_name?.toLowerCase();
  const head = event.workflow_run?.head_sha;
  if (!target || !/^[0-9a-f]{40}$/i.test(head ?? "")) return null;
  const recorded = new Set((event.workflow_run.pull_requests ?? []).map(p => p.number));
  const matches = knownPulls.filter(p => p.base?.repo?.full_name?.toLowerCase() === target &&
    p.state === "open" && p.head?.sha === head && Number.isSafeInteger(p.number) && p.number > 0 &&
    (!recorded.size || recorded.has(p.number)));
  return matches.length === 1 ? matches[0].number : null;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const number = selectEventPull(...process.argv.slice(2,4).map(file => JSON.parse(readFileSync(file, "utf8"))));
  if (number) process.stdout.write(String(number));
}
