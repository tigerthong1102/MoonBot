import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { VerbContext } from "../headless/context.ts";
import { EXIT } from "../headless/args.ts";

interface Ticket { key: string; title: string; status: string; url: string }
const MAX_ISSUES = 100;
const asKey = (raw: string) => {
  if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(raw)) throw new Error("Choose a project or team key.");
  return raw;
};
async function json(url: string, options: RequestInit, fetcher: typeof fetch) {
  const response = await fetcher(url, { ...options, redirect: "error", signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error("Issue provider returned HTTP " + response.status + ".");
  return response.json() as Promise<unknown>;
}
const gitlabIssues = z.array(z.object({ iid: z.number(), title: z.string(), state: z.string(), web_url: z.string() }));
const linearIssues = z.object({ data: z.object({ issues: z.object({ nodes: z.array(z.object({ identifier: z.string(), title: z.string(), url: z.string(), state: z.object({ name: z.string() }) })) }) }) });
const jiraIssues = z.object({ issues: z.array(z.object({ key: z.string(), fields: z.object({ summary: z.string(), status: z.object({ name: z.string() }) }) })) });

/** Adapted from Orca's open-issue filter, src/main/linear/issues/issue-list-filter.ts (MIT, Lovecast Inc.). */
const activeLinear = { state: { type: { nin: ["completed", "canceled"] } } };
export async function readTracker(tracker: string, scope: string, site: string, env: NodeJS.ProcessEnv, fetcher = fetch): Promise<Ticket[]> {
  if (tracker === "gitlab") {
    if (!/^[\w.-]+(?:\/[\w.-]+)+$/.test(scope) || scope.split("/").some(part => part === "." || part === "..")) throw new Error("Choose a GitLab.com group/project.");
    const entries = gitlabIssues.parse(await json("https://gitlab.com/api/v4/projects/" + encodeURIComponent(scope) + "/issues?state=opened&per_page=100",
      { headers: env.GITLAB_TOKEN ? { "PRIVATE-TOKEN": env.GITLAB_TOKEN } : {} }, fetcher));
    return entries.map(i => ({ key: "#" + i.iid, title: i.title, status: i.state, url: i.web_url }));
  }
  const key = asKey(scope);
  if (tracker === "linear") {
    if (!env.LINEAR_API_KEY) throw new Error("Set LINEAR_API_KEY for the selected Linear team.");
    const response = await json("https://api.linear.app/graphql", { method: "POST", headers: { Authorization: env.LINEAR_API_KEY, "Content-Type":"application/json" },
      body: JSON.stringify({ query: "query Board($filter:IssueFilter!){issues(first:100,filter:$filter){nodes{identifier title url state{name}}}}",
        variables:{ filter: { ...activeLinear, team: { key: { eq: key } } } } }) }, fetcher);
    return linearIssues.parse(response).data.issues.nodes.map(i => ({ key:i.identifier, title:i.title, status:i.state.name, url:i.url }));
  }
  if (tracker !== "jira") throw new Error("Choose gitlab, linear or jira.");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?\.atlassian\.net$/.test(site)) throw new Error("Choose your Jira Cloud site under atlassian.net.");
  if (!env.JIRA_EMAIL || !env.JIRA_API_TOKEN) throw new Error("Set JIRA_EMAIL and JIRA_API_TOKEN for the selected site.");
  const headers = { Authorization: "Basic " + Buffer.from(env.JIRA_EMAIL + ":" + env.JIRA_API_TOKEN).toString("base64"), "Content-Type":"application/json" };
  const response = await json("https://" + site + "/rest/api/3/search/jql", { method: "POST", headers,
    body: JSON.stringify({ jql:'project = "' + key + '" AND statusCategory != Done ORDER BY updated DESC', maxResults: MAX_ISSUES, fields: ["summary","status"] }) }, fetcher);
  return jiraIssues.parse(response).issues.map(i => ({ key:i.key, title:i.fields.summary, status:i.fields.status.name, url:"https://" + site + "/browse/" + encodeURIComponent(i.key) }));
}

export function saveBoard(path: string, title: string, tickets: Ticket[]) {
  const esc = (s: string) => s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
  const rows = tickets.map(i => {
    let link = esc(i.key);
    try { if (new URL(i.url).protocol === "https:") link = '<a rel="noreferrer" href="' + esc(i.url) + '">' + link + '</a>'; } catch {}
    return "<tr><th scope=row>" + link + "</th><td>" + esc(i.title) + "</td><td>" + esc(i.status) + "</td></tr>";
  }).join("");
  writeFileSync(path, '<!doctype html><html lang="en"><meta charset=utf-8><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title><style>body{max-width:58rem;margin:3rem auto;padding:0 1rem;font:16px/1.5 system-ui}table{width:100%;border-collapse:collapse}td,th{text-align:left;border-bottom:1px solid #ccc;padding:.5rem}a{color:#1549ab}</style><h1>' + esc(title) + '</h1><table><thead><tr><th>Issue</th><th>Title</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></html>', { flag:"wx", mode:0o600 });
  return resolve(path);
}

export async function trackerCommand(ctx: VerbContext) {
  if (ctx.flags.github || ctx.flags.project) throw new Error("Choose one tracker per board.");
  const tracker = String(ctx.flags.tracker), scope = String(ctx.flags.scope || "");
  const issues = await readTracker(tracker, scope, String(ctx.flags.site || ""), ctx.env);
  const output = ctx.flags.out ? saveBoard(String(ctx.flags.out), tracker + " · " + scope, issues) : undefined;
  return { result:{tracker,scope,issues,limit:MAX_ISSUES,output}, human: output ? [output] : issues.map(i=>i.key + " " + i.title), exitCode:EXIT.done };
}
