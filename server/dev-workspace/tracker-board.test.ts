import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectTickets, readTracker, saveBoard } from "./tracker-board.ts";

it("reads Linear, GitLab and Jira without forwarding credentials to a changed origin", async () => {
  const seen: { url: string; options: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, options = {}) => {
    const url = String(input);
    seen.push({url,options});
    const reply = url.includes("gitlab.com") ? [{iid:1,title:"One",state:"opened",web_url:"https://gitlab.com/a/b/-/issues/1"}]
      : url.includes("linear.app") ? {data:{issues:{nodes:[{identifier:"DEV-1",title:"One",url:"https://linear.app/one",state:{name:"Todo"}}]}}}
      : {issues:[{key:"DEV-1",fields:{summary:"One",status:{name:"Todo"}}}]};
    return Response.json(reply);
  };
  expect((await readTracker("gitlab","a/b","",{},fetcher))[0]?.key).toBe("#1");
  expect((await readTracker("linear","DEV","",{LINEAR_API_KEY:"fixture"},fetcher))[0]?.key).toBe("DEV-1");
  expect((await readTracker("jira","DEV","test.atlassian.net",{JIRA_EMAIL:"fixture@example.invalid",JIRA_API_TOKEN:"fixture"},fetcher))[0]?.url).toBe("https://test.atlassian.net/browse/DEV-1");
  expect(seen.every(call=>call.options.redirect==="error")).toBe(true);
  await expect(readTracker("jira","DEV","evil.example",{},fetcher)).rejects.toThrow();
  await expect(readTracker("jira",'X" OR Y',"test.atlassian.net",{},fetcher)).rejects.toThrow();
  expect(seen).toHaveLength(3);
});
it("escapes titles and renders only HTTPS links in an exclusive new board", () => {
  const dir=mkdtempSync(join(tmpdir(),"startupbot-board-"));
  try {
    const path=join(dir,"board.html");
    saveBoard(path,"<team>",[{key:"ID",title:"<script>",status:"Todo",url:"javascript:alert(1)"}]);
    const html=readFileSync(path,"utf8");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(()=>saveBoard(path,"another",[])).toThrow();
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

it("keeps a project's own cards, including draft items without repository URLs", () => {
  const cards=projectTickets({items:[{title:"Roadmap",status:"Planning",content:{type:"DraftIssue"}},{content:{title:"Bug",repository:"team/other",number:19,url:"https://github.com/team/other/issues/19"}}]});
  expect(cards[0]).toMatchObject({title:"Roadmap",status:"Planning",url:""});
  expect(cards[1]).toMatchObject({key:"team/other#19",title:"Bug"});
});
