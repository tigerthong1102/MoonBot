import { expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeFork, readClaudeHeader } from "./local-claude-history.ts";
import { searchRollouts } from "./local-codex-history.ts";
it("lists selected Claude fields and forks only the active account's primary session in its original directory", () => {
  const home = mkdtempSync(join(tmpdir(), "startupbot-claude-"));
  const project = join(home, "projects", "dev");
  mkdirSync(project,{recursive:true});
  const id = "a2345678-1234-1234-1234-123456789abc";
  const file = join(project,id+".jsonl");
  const record = { sessionId:id, cwd:process.cwd(), gitBranch:"dev", message:{content:"invisible phrase"}, type:"user" };
  try {
    writeFileSync(file,JSON.stringify(record));
    expect(claudeFork(file,home)).toMatchObject({id,cwd:process.cwd(),branch:"dev"});
    expect(searchRollouts(project,"dev",readClaudeHeader).results).toHaveLength(1);
    expect(searchRollouts(project,"invisible",readClaudeHeader).results).toEqual([]);
    writeFileSync(file,JSON.stringify({...record,isSidechain:true}));
    expect(readClaudeHeader(file)).toBeNull();
    writeFileSync(file,JSON.stringify({...record,cwd:home}));
    expect(()=>claudeFork(file,home)).toThrow(/directory/);
    const outside=join(home,id+".jsonl");writeFileSync(outside,JSON.stringify(record));
    expect(()=>claudeFork(outside,home)).toThrow(/primary session/);
  } finally { rmSync(home,{recursive:true,force:true}); }
});
