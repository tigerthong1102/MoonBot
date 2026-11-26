import { describe, expect, it } from "vitest";

import { parseRunCommand } from "../run-command.ts";
import { draftWorkflow, layerLabel } from "./draft.ts";
import { applyChoices } from "./draft-view.ts";
import { renderWorkflowSkillMd, workflowSchema, workflowSkillName } from "./format.ts";
import { burgerLayers, type RunMessage } from "./layers.ts";

let n = 0;
const ask = (text: string): RunMessage => ({ id: `u${++n}`, role: "user", kind: "text", text });
const tool = (name: string, input: unknown, extra: Partial<NonNullable<RunMessage["tool"]>> = {}): RunMessage => ({
  id: `m${++n}`, role: "bot", kind: "activity",
  tool: { name, ok: true, input: typeof input === "string" ? input : JSON.stringify(input), ...extra },
});
const multi = (slug: string, args: unknown, output?: unknown) =>
  tool("mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: slug, arguments: args }] }, output === undefined ? {} : { output: JSON.stringify(output) });

describe("where each step ran", () => {
  it.each([
    `python3 -c "open('report.csv','w').write('ok')"`,
    `node --eval "require('fs').readFileSync('report.csv')"`,
    `awk '{ print $1 }' report.csv > output.csv`,
  ])("hands embedded interpreter source back to the bot: %s", (command) => {
    const { workflow } = draftWorkflow([ask("Process report.csv"), tool("Bash", { command }), tool("Bash", { command: "cp report.csv archive.csv" })])!;
    expect(workflow.steps[0]).toMatchObject({ kind: "ai", prompt: expect.stringContaining("Treat input values as data") });
  });
  it("leaves out the app's own status rows", () => {
    const run = [ask("Archive it"), tool("recovery: Automatic recovery: trying Backup once in this thread.", {}), tool("notice: The model changed.", {}), tool("Bash", { command: "cp a.csv archive/" }, { summary: "cp a.csv archive/" })];
    expect(burgerLayers(run).map((layer) => layer.kind)).toEqual(["shell"]);
  });

  it("marks apps, the browser, the bot's own commands, the cloud computer and the person's computer", () => {
    const run = [
      ask("Archive the report and post it"),
      multi("GMAIL_SEND_EMAIL", { recipient_email: "priya@example.com", subject: "Report" }),
      tool("mcp__browser__browser_navigate", { url: "https://example.com/report" }),
      tool("Bash", { command: "cp report.csv archive/report.csv" }, { summary: "cp report.csv archive/report.csv" }),
      tool("mcp__agents__vm_exec", { command: "python3 make_report.py" }),
      tool("mcp__computer__exec", { command: "mkdir -p /home/cua/out" }),
      tool("mcp__computer__open_url", { url: "https://sheets.example.com/x" }),
      tool("mcp__localComputer__click", { x: 10, y: 20 }),
    ];
    expect(burgerLayers(run).map((layer) => [layer.kind, layer.where])).toEqual([
      ["app", "app"], ["browser", "browser"], ["shell", "bot"], ["shell", "vm"], ["shell", "vm"], ["browser", "vm"], ["computer", "yourComputer"],
    ]);
  });

  it("drops looks at a desktop, and joins its clicks and typing into one step the AI does again", () => {
    const run = [
      ask("Fill the form on the cloud computer"),
      tool("mcp__computer__screenshot", {}),
      tool("mcp__computer__click", { x: 100, y: 200 }),
      tool("mcp__computer__type_text", { text: "Acme Ltd" }),
      tool("mcp__computer__key_press", { key: "Return" }),
      tool("mcp__computer__screenshot", {}),
      multi("GMAIL_SEND_EMAIL", { recipient_email: "priya@example.com", subject: "Done" }),
    ];
    const layers = burgerLayers(run);
    expect(layers.map((layer) => [layer.kind, layer.where, layer.words])).toEqual([
      ["computer", "vm", "click, type text, key press"], ["app", "app", "send email"],
    ]);
    expect(layers[0]!.replay).toBe("ai");
    expect((layers[0]!.args as { actions: unknown[] }).actions).toHaveLength(3);
    const { workflow } = draftWorkflow(run)!;
    expect(workflow.steps[0]).toMatchObject({ kind: "ai", where: "vm" });
    expect((workflow.steps[0] as { prompt: string }).prompt).toContain("on the cloud computer");
    expect(workflowSchema.safeParse(workflow).success).toBe(true);
    expect(renderWorkflowSkillMd("fill-form", workflow)).toContain("on the cloud computer");
  });

  it("saves a cloud computer command to run there again, exactly", () => {
    const run = [ask("Make the report"), tool("mcp__computer__exec", { command: "python3 make_report.py" }), tool("Bash", { command: "cp out.pdf ~/Reports/" }, { summary: "cp out.pdf ~/Reports/" })];
    const { workflow } = draftWorkflow(run)!;
    expect(workflow.steps.map((step) => [step.kind, step.where])).toEqual([["shell", "vm"], ["shell", "bot"]]);
  });
});

describe("burger layers", () => {
  it("keeps real steps and drops looking around, tool searches and replaced failures", () => {
    const run = [
      ask("Email the sales sheet to priya@example.com"),
      tool("Bash", { command: "ls -la" }, { summary: "ls -la" }),
      tool("mcp__composio__COMPOSIO_SEARCH_TOOLS", { queries: ["sheets"] }),
      multi("GOOGLESHEETS_BATCH_GET", { spreadsheet_id: "1AbCdEf", ranges: ["A1:C9"] }),
      { ...multi("GMAIL_SEND_EMAIL", { recipient_email: "priya@example.com" }), tool: { name: "mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL", ok: false, input: JSON.stringify({ tools: [{ tool_slug: "GMAIL_SEND_EMAIL", arguments: {} }] }) } },
      multi("GMAIL_SEND_EMAIL", { recipient_email: "priya@example.com", subject: "Sales" }),
      tool("Read", { file_path: "/tmp/a.txt" }),
      tool("mcp__browser__browser_snapshot", {}),
    ];
    const layers = burgerLayers(run);
    expect(layers.map((layer) => [layer.kind, layer.app, layer.words, layer.status])).toEqual([
      ["app", "googlesheets", "batch get", "done"],
      ["app", "gmail", "send email", "done"],
    ]);
    expect(layers[0]!.read).toBe(true);
    expect(layers[1]!.read).toBe(false);
  });

  it("reads only the run since the person's last ask, and marks the live step running", () => {
    const old = tool("Bash", { command: "git push" }, { summary: "git push" });
    const live = tool("Bash", { command: "pnpm build" }, { summary: "pnpm build", ok: undefined });
    const layers = burgerLayers([old, ask("build it"), live], new Set([live.id]));
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ kind: "shell", words: "pnpm build", status: "running" });
  });

  it("names shell, file and browser layers", () => {
    const layers = burgerLayers([
      ask("publish"),
      tool("Bash", { command: "git push origin main" }, { summary: "git push origin main" }),
      tool("Write", { file_path: "/w/notes.md", content: "hi" }),
      tool("mcp__browser__browser_navigate", { url: "https://example.com/dash" }),
    ]);
    expect(layers.map(layerLabel)).toEqual(["Run git push origin main", "Write notes.md", "Open example.com"]);
  });
});

describe("Git commands in saved runs", () => {
  it.each(["'EOF'", '"EOF"', "EOF", "\\EOF"])("hands heredocs with delimiter %s to the bot without changing their bodies", (delimiter) => {
    const command = `cat <<${delimiter} > out.txt\nVisit https://example.org\nEOF`;
    const { workflow } = draftWorkflow([ask("Write https://example.org to a file"), tool("Bash", { command }), tool("Bash", { command: "cp out.txt archive.txt" })])!;
    expect(workflow.steps[0]).toMatchObject({ kind: "ai", prompt: expect.stringContaining("heredoc's expansion") });
    expect(JSON.stringify(workflow.steps[0])).toContain("https://example.org");
  });
  it.each(["/projects/customer-a/notes.md", "C:\\projects\\customer-a\\notes.md"])("does not save an unscoped absolute destination %s as an exact file step", (path) => {
    const { workflow } = draftWorkflow([ask("Write a note"), tool("Write", { file_path: path, content: "hello" }), tool("Bash", { command: "echo done > marker.txt" })])!;
    expect(workflow.steps[0]).toMatchObject({ kind: "ai", deterministic: false, prompt: expect.stringContaining("safe relative destination") });
  });
  it.each([
    "git branch",
    "git branch -r",
    "git branch -a",
    "git branch --contains HEAD",
    "git branch --sort -creatordate",
    "git tag --list release-*",
    "git tag -v v1",
    "git tag --points-at HEAD",
    "git remote -v",
    "git remote show -n origin",
    "git remote get-url --push origin",
  ])("excludes the read-only command %s", (command) => {
    expect(parseRunCommand(command)).toBeUndefined();
  });

  it.each([
    ["git branch release", "git branch"],
    ["git branch --unset-upstream", "git branch"],
    ["git -C repo branch -rd origin/old", "git branch"],
    ["git tag v1", "git tag"],
    ["git tag -d v1", "git tag"],
    ["git tag -am note v1", "git tag"],
    ["git remote add mirror https://example.test/repo", "git remote"],
    ["git remote set-url origin https://example.test/repo", "git remote"],
  ])("keeps the change from %s", (command, label) => {
    expect(parseRunCommand(command)).toMatchObject({ label });
  });
});

describe("draftWorkflow", () => {
  it("returns nothing for a run of fewer than two steps", () => {
    expect(draftWorkflow([ask("hi"), tool("Bash", { command: "git push" }, { summary: "git push" })])).toBeNull();
  });

  it("turns values from the ask into args and pipes values an earlier step returned", () => {
    const draft = draftWorkflow([
      ask("Send the latest invoice to priya@example.com"),
      multi("GMAIL_FETCH_EMAILS", { query: "invoice" }, { data: { results: [{ response: { data: { messages: [{ id: "18c0ffee99", subject: "Invoice" }] } } }] } }),
      multi("GMAIL_FORWARD_MESSAGE", { message_id: "18c0ffee99", recipient_email: "priya@example.com" }),
    ])!;
    expect(workflowSchema.safeParse(draft.workflow).success).toBe(true);
    expect(draft.workflow.summary).toBe("Send the latest invoice to priya@example.com");
    expect(draft.workflow.args).toEqual({ recipient: { default: "priya@example.com", label: "recipient email" }, query: { default: "invoice", label: "query" } });
    const forward = draft.workflow.steps[1]!;
    expect(forward).toMatchObject({ kind: "app", app: "gmail", tool: "GMAIL_FORWARD_MESSAGE" });
    expect(forward.kind === "app" && forward.args).toEqual({
      message_id: { $step: "s1", path: "data.results.0.response.data.messages.0.id" },
      recipient_email: { $arg: "recipient" },
    });
  });

  it("passes a shell arg through the environment, never into quoted text", () => {
    const draft = draftWorkflow([
      ask("deploy the staging branch"),
      tool("Bash", { command: "git push origin staging" }, { summary: "git push origin staging" }),
      tool("Bash", { command: "cp out.txt 'staging done.txt'" }, { summary: "cp out.txt 'staging done.txt'" }),
    ])!;
    const [push, note] = draft.workflow.steps;
    expect(push).toMatchObject({ kind: "shell", run: 'git push origin "$OMB_ARG_VALUE"' });
    expect(note).toMatchObject({ kind: "shell", run: "cp out.txt 'staging done.txt'" });
    expect(draft.workflow.args).toEqual({ value: { default: "staging" } });
  });

  it("records the interpreter for Bash and marks unspecified shells as unknown", () => {
    const { workflow } = draftWorkflow([ask("Make files"), tool("Bash", { command: "echo {north,south} > regions.txt" }), tool("run_shell_command", { command: "echo data > output.txt" })])!;
    expect(workflow.steps).toMatchObject([{ kind: "shell", shell: "bash" }, { kind: "shell", shell: "unknown" }]);
  });

  it.each(["cwd", "Cwd", "workdir", "working_directory", "directory", "dir"])(
    "saves the ACP working directory supplied as %s for both shell steps",
    (key) => {
      const commands = ["python scripts/report.py", "cp reports/current.csv reports/archive.csv"];
      const cwd = "/projects/customer-a";
      const commandKey = key === "Cwd" ? "CommandLine" : "command";
      const { workflow } = draftWorkflow([
        ask("Archive the report"),
        ...commands.map((command) => tool("run_shell_command", { [commandKey]: command, [key]: cwd })),
      ])!;
      expect(workflow.steps).toMatchObject(commands.map((run) => ({ kind: "shell", run, cwd })));
    },
  );

  it("records conflicting ACP directories as context for an AI step", () => {
    const command = "python scripts/report.py";
    const { workflow } = draftWorkflow([
      ask("Archive the report"),
      tool("run_shell_command", { command, cwd: "/projects/customer-a", workdir: "/projects/customer-b" }),
      tool("run_shell_command", { command: "cp report.csv archive.csv" }),
    ])!;
    expect(workflow.steps[0]).toMatchObject({
      kind: "ai",
      prompt: expect.stringContaining('"/projects/customer-a","workdir":"/projects/customer-b"'),
    });
  });

  it.each([
    ["/Users/ana/task-workspaces/ae3a6bd7-afb4-4ad1-909b-5a7b6d887ac9/a48d8ea2-161f-4ca1-a80c-0591f3082283/reports", "./reports"],
    ["C:\\Users\\ana\\task-workspaces\\ae3a6bd7-afb4-4ad1-909b-5a7b6d887ac9\\a48d8ea2-161f-4ca1-a80c-0591f3082283\\reports", ".\\reports"],
    ["/Users/Ana Maria/task-workspaces/ae3a6bd7-afb4-4ad1-909b-5a7b6d887ac9/a48d8ea2-161f-4ca1-a80c-0591f3082283/reports", "./reports"],
    ["C:\\Users\\Ana Maria\\task-workspaces\\ae3a6bd7-afb4-4ad1-909b-5a7b6d887ac9\\a48d8ea2-161f-4ca1-a80c-0591f3082283\\reports", ".\\reports"],
  ])("preserves the task workspace subdirectory in %s", (cwd, expected) => {
    const { workflow } = draftWorkflow([ask("Archive the report"), tool("run_shell_command", { command: "python report.py", cwd }), tool("run_shell_command", { command: "cp result.csv archive.csv" })])!;
    expect(workflow.steps[0]).toMatchObject({ kind: "shell", cwd: expected });
  });

  it("keeps a redirected write in order before the commands that use its file", () => {
    const commands = ["printf report > report.txt", "cp report.txt archive.txt", "python make_appendix.py report.txt"];
    const { workflow } = draftWorkflow([
      ask("Archive the files and make the appendix"),
      ...commands.map((command) => tool("Bash", { command }, { summary: command.split(" > ")[0] })),
    ])!;
    expect(workflow.steps.map((step) => step.kind === "shell" ? step.run : step.kind)).toEqual(commands);
  });

  it("keeps Git ref and remote changes in the saved workflow", () => {
    const commands = ["git -C repo branch candidate", "git checkout candidate", "git tag checkpoint", "git remote add mirror https://example.test/repo"];
    const { workflow } = draftWorkflow([
      ask("Prepare a snapshot"),
      tool("Bash", { command: "git branch --list" }),
      ...commands.map((command) => tool("Bash", { command })),
    ])!;
    expect(workflow.steps.map((step) => step.kind === "shell" ? step.run : step.kind)).toEqual(commands);
  });

  it.each(["sort -o report.csv raw.csv", "sort -roreport.csv raw.csv", "sort --output=report.csv raw.csv", 'find . -name "*.tmp" -delete', "find . -fprint inventory.txt"])(
    "keeps the file-changing command %s",
    (command) => {
      const { workflow } = draftWorkflow([ask("Update the archive"), tool("Bash", { command }), tool("Bash", { command: "cp archive.tar backup.tar" })])!;
      expect(workflow.steps[0]).toMatchObject({ kind: "shell", run: command });
    },
  );

  it.each(["sort raw.csv", "sort -- -o", 'find . -name "*.tmp"'])("leaves %s out of the saved workflow", (command) => {
    expect(burgerLayers([ask("Look for the raw files"), tool("Bash", { command })])).toEqual([]);
  });

  it.each(["Edit", "MultiEdit"])("keeps the change requested by %s as context for an AI step", (name) => {
    const replacement = { old_string: '"retries": 1', new_string: '"retries": 4' };
    const { workflow } = draftWorkflow([
      ask("Update the configuration and make a copy"),
      tool(name, { file_path: "/work/config.json", ...(name === "Edit" ? replacement : { edits: [replacement] }) }),
      tool("Bash", { command: "cp config.json backup.json" }),
    ])!;
    const [change] = workflow.steps;
    expect(change).toMatchObject({ kind: "ai", deterministic: false, label: "Config.json" });
    if (change?.kind !== "ai") throw new Error("Expected an AI step");
    expect(change.prompt).toContain(JSON.stringify(replacement.old_string));
    expect(change.prompt).toContain(JSON.stringify(replacement.new_string));
  });

  it("omits edit arguments containing a credential from the saved AI step", () => {
    const secret = `sk-ant-${"a".repeat(40)}`;
    const { workflow } = draftWorkflow([
      ask("Update the configuration"),
      tool("Edit", { file_path: "/work/config.json", old_string: "placeholder", new_string: secret }),
      tool("Bash", { command: "cp config.json backup.json" }),
    ])!;
    expect(workflow.steps[0]).toMatchObject({ kind: "ai", prompt: expect.stringContaining("used a secret") });
    expect(JSON.stringify(workflow)).not.toContain(secret);
  });

  it.each(["printf report >>report.txt", "printf report >| report.txt", "cat input.txt 2>errors.log", "printf report &>report.txt"])(
    "captures the shell write %s",
    (command) => {
      expect(burgerLayers([ask("Save the data"), tool("Bash", { command })])).toMatchObject([{ kind: "shell", args: { command } }]);
    },
  );

  it.each(["printf '%s' 'a > b'", 'printf "%s" "a > b"', "printf a\\>b", "cat < file.txt", "cat file.txt 2>&1", "cat file.txt > /dev/null"])(
    "does not save %s as a file write",
    (command) => {
      expect(burgerLayers([ask("Read the data"), tool("Bash", { command })])).toEqual([]);
    },
  );

  it("writes long text the AI composed from a read with an AI step, marked non-deterministic", () => {
    const body = "Revenue rose 4% this week.\nTop region: West.\nNotes follow for the team, with every number checked against the sheet.";
    const draft = draftWorkflow([
      ask("Summarise the sales sheet and email it to the team"),
      multi("GOOGLESHEETS_BATCH_GET", { spreadsheet_id: "1AbCdEf" }, { data: { values: [["West", 40]] } }),
      multi("GMAIL_SEND_EMAIL", { recipient_email: "team@example.com", body }),
    ])!;
    const steps = draft.workflow.steps;
    expect(steps.map((step) => [step.id, step.kind])).toEqual([["s1", "app"], ["s2_write_2", "ai"], ["s2", "app"]]);
    expect(steps[1]).toMatchObject({ deterministic: false, input: { $step: "s1" }, example: body, label: "Write the body" });
    expect(steps[2]!.kind === "app" && steps[2]!.args.body).toEqual({ $step: "s2_write_2" });
    const kept = applyChoices(draft.workflow, { skip: ["s2"] });
    expect("error" in kept ? kept : kept.steps.map((step) => step.id)).toEqual(["s1"]);
  });

  it("references distinct composition steps for two fields of the same app call", () => {
    const title = "Decision summary. ".repeat(20);
    const body = "Details from the report. ".repeat(30);
    const { workflow } = draftWorkflow([
      ask("Create an issue using the report"),
      multi("GOOGLESHEETS_BATCH_GET", { spreadsheet_id: "report" }, { data: { values: [["West", 40]] } }),
      multi("GITHUB_CREATE_ISSUE", { title, body }),
    ])!;
    const [read, titleStep, bodyStep, issue] = workflow.steps;
    expect(titleStep).toMatchObject({ kind: "ai", label: "Write the title", input: { $step: read!.id }, example: title });
    expect(bodyStep).toMatchObject({ kind: "ai", label: "Write the body", input: { $step: read!.id }, example: body });
    expect(titleStep!.id).not.toBe(bodyStep!.id);
    expect(issue).toMatchObject({ kind: "app", args: { title: { $step: titleStep!.id }, body: { $step: bodyStep!.id } } });
  });

  it("preserves the account chosen for each app call in a multi-execute batch", () => {
    const { workflow } = draftWorkflow([
      ask("Sort the inboxes"),
      tool("mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [
        { tool_slug: "GMAIL_FETCH_EMAILS", arguments: { query: "invoice" }, account: "finance" },
        { tool_slug: "GMAIL_FETCH_EMAILS", arguments: { query: "customer" }, account: "support" },
        { tool_slug: "OUTLOOK_LIST_MESSAGES", arguments: { top: 5 } },
      ] }),
    ])!;
    expect(workflow.steps.map((step) => step.kind === "app" ? [step.tool, step.account] : step.kind)).toEqual([
      ["GMAIL_FETCH_EMAILS", "finance"], ["GMAIL_FETCH_EMAILS", "support"], ["OUTLOOK_LIST_MESSAGES", undefined],
    ]);
  });

  it("saves a clipped, masked or code-running call as an AI step instead of guessing", () => {
    const draft = draftWorkflow([
      ask("tidy up"),
      multi("GMAIL_SEND_EMAIL", { recipient_email: "a@example.com", body: "[large content omitted]" }),
      tool("mcp__browser__browser_click", { ref: "e12" }),
      multi("COMPOSIO_REMOTE_WORKBENCH", { code: "print(1)" }),
    ])!;
    expect(draft.workflow.steps.map((step) => [step.kind, step.kind === "ai" && step.deterministic])).toEqual([["ai", false], ["ai", false], ["ai", false]]);
  });

  it("writes no secret into the saved workflow", () => {
    const key = `sk-ant-${"a".repeat(40)}`;
    const draft = draftWorkflow([
      ask(`call the api with ${key}`),
      tool("Bash", { command: `curl -X POST -H "Authorization: Bearer ${key}" https://api.example.com/run` }, { summary: "curl -X POST https://api.example.com/run" }),
      multi("SLACK_SEND_MESSAGE", { channel: "#ops", text: "ran" }),
    ])!;
    const saved = JSON.stringify(draft.workflow);
    expect(saved).not.toContain(key);
    expect(draft.workflow.steps[0]).toMatchObject({ kind: "ai", deterministic: false });
    expect(saved).not.toContain("aaaaaaaaaaaaaaaa");
  });

  it("renders a SKILL.md any bot can follow", () => {
    const draft = draftWorkflow([
      ask("Send the latest invoice to priya@example.com"),
      multi("GMAIL_FETCH_EMAILS", { query: "invoice" }),
      multi("GMAIL_SEND_EMAIL", { recipient_email: "priya@example.com" }),
    ])!;
    const name = workflowSkillName(draft.workflow.summary, new Set(["send-the-latest-invoice-to-priya"]));
    expect(name).toBe("send-the-latest-invoice-to-priya-2");
    expect(workflowSkillName("Email this week's sales sheet", new Set())).toBe("email-this-weeks-sales-sheet");
    const md = renderWorkflowSkillMd(name, draft.workflow);
    expect(md).toContain(`name: ${name}`);
    expect(md).toContain("tags: workflow");
    expect(md).toContain("2. Gmail: Send email (GMAIL_SEND_EMAIL) (recipient email: recipient, default \"priya@example.com\")");
  });
});
