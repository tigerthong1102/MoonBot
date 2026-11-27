import { run } from "./command.ts";

// Hunk preview copied from stablyai/orca src/shared/github/comments/pr-comment-diff-hunk.ts.
// Copyright (c) 2026 Lovecast Inc., MIT. See public/licenses/orca.txt.
// GitHub ends a review comment's diff hunk on the line the thread is anchored to, so its tail is the code in question.

const HUNK_TAIL_LINES = 8

export function tailDiffHunk(hunk: string | null | undefined): string | undefined {
  if (!hunk) {
    return undefined
  }
  const lines = hunk.split('\n').filter((line) => !line.startsWith('@@'))
  return lines.length > 0 ? lines.slice(-HUNK_TAIL_LINES).join('\n') : undefined
}

export function readPull(cwd: string, repository: string, number: number) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !Number.isSafeInteger(number) || number < 1) throw new Error("Choose OWNER/REPO and a positive PR number.");
  const view = (fields: string) => JSON.parse(run("gh", ["pr", "view", String(number), "--repo", repository, "--json", fields], cwd));
  const pr = view("number,title,url,headRefOid,baseRefOid,baseRefName,headRefName,statusCheckRollup");
  const comments = JSON.parse(run("gh", ["api", "--paginate", "--slurp", "repos/" + repository + "/pulls/" + number + "/comments?per_page=100"], cwd)).flat();
  const [owner, repo] = repository.split("/");
  const threadsQuery = "query($owner:String!,$repo:String!,$n:Int!,$endCursor:String){repository(owner:$owner,name:$repo){pullRequest(number:$n){reviewThreads(first:100,after:$endCursor){nodes{id isResolved isOutdated path line comments(first:1){nodes{url}}} pageInfo{hasNextPage endCursor}}}}}";
  const pages = JSON.parse(run("gh", ["api", "graphql", "--paginate", "--slurp", "-f", "query=" + threadsQuery, "-f", "owner=" + owner, "-f", "repo=" + repo, "-F", "n=" + number], cwd));
  const threads = pages.flatMap((page: { data: { repository: { pullRequest: { reviewThreads: { nodes: { isResolved: boolean; isOutdated: boolean; path: string; line: number | null; comments: { nodes: { url: string }[] } }[] } } } } }) =>
    page.data.repository.pullRequest.reviewThreads.nodes.map(thread => ({ resolved: thread.isResolved, outdated: thread.isOutdated, path: thread.path, line: thread.line, url: thread.comments.nodes[0]?.url || "" })));
  const latest = view("headRefOid,baseRefOid");
  if (latest.headRefOid !== pr.headRefOid || latest.baseRefOid !== pr.baseRefOid) throw new Error("The PR head changed. Refresh its review.");
  return { repository, number, threads, title: String(pr.title), url: String(pr.url), head: String(pr.headRefOid), base: String(pr.baseRefOid),
    headRef: String(pr.headRefName), baseRef: String(pr.baseRefName), checks: pr.statusCheckRollup.map((c: Record<string, unknown>) => ({
      name: String(c.name ?? c.context ?? ""), status: String(c.conclusion || c.state || c.status || ""), url: String(c.detailsUrl || c.targetUrl || "") })),
    comments: comments.map((c: Record<string, unknown>) => ({
      path: String(c.path), side: String(c.side ?? ""), line: c.line ?? null, body: String(c.body), context: tailDiffHunk(String(c.diff_hunk ?? "")), revision: String(c.commit_id), url: String(c.html_url) })) };
}
