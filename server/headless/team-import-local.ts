// OpenClaw identity parsing adapted from stablyai/orca src/main/bots/bot-import-sources.ts.
// Copyright (c) 2026 Lovecast Inc., MIT. See public/licenses/orca.txt.
import { constants, closeSync, fstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, unlinkSync, rmdirSync, writeFileSync, type Dirent } from "node:fs";
import { createHash } from "node:crypto";
import { holdsCredential } from "../../shared/redact.ts";
import { parseSkillMd } from "../../shared/skill-md.ts";
import { basename, dirname, join, resolve } from "node:path";
import { BOT_PROFILE_LIMITS } from "../../shared/bot-profile.ts";
import { EXIT, usageError } from "./args.ts";
import type { VerbContext } from "./context.ts";
import { loadTeamFile, SKILL_MAX_BYTES } from "./team-file.ts";

function boundedFile(path: string, limit: number): string | undefined {
  let handle: number;
  try { handle = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  try {
    const info = fstatSync(handle);
    if (!info.isFile() || info.nlink !== 1 || info.size > limit || realpathSync(path) !== path) throw new Error("Choose an ordinary file within the size limit: " + basename(path));
    const data = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < data.length) {
      const n = readSync(handle, data, offset, data.length - offset, null);
      if (!n) break;
      offset += n;
    }
    if (offset > limit) throw new Error("File exceeds the import limit: " + basename(path));
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data.subarray(0, offset));
  } finally { closeSync(handle); }
}

export function reviewOpenClaw(workspace: string, destination: string, includeSkills: boolean, options: { notes?: string; dryRun?: boolean } = {}) {
  const root = realpathSync(workspace);
  const identity = boundedFile(join(root, "IDENTITY.md"), 16_384);
  const match = identity?.match(/^[\s*-]*\**name\**\s*:\s*\**\s*(.+?)\s*$/im);
  const name = match?.[1]?.replace(/\*+$/, "").trim();
  const soul = boundedFile(join(root, "SOUL.md"), BOT_PROFILE_LIMITS.soul);
  if (!name && !soul && !options.notes) throw usageError("Choose an OpenClaw workspace with IDENTITY.md or SOUL.md.");
  const notes = [...new Set((options.notes ?? "").split(",").map(path => path.trim()).filter(Boolean))].sort();
  if (notes.length > 32 || notes.some(path => !/^(?:AGENTS|USER|MEMORY)\.md$|^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(path))) {
    throw usageError("Choose AGENTS.md, USER.md, MEMORY.md, or up to 32 dated memory/YYYY-MM-DD.md notes.");
  }
  const items: { source: string; sha256: string; bytes: number; file: string; duplicateOf?: string }[] = [];
  const skills: { file: string; text: string }[] = [];
  if (includeSkills) {
    const skillDir = join(root, "skills");
    let dirs: Dirent[];
    try {
      if (realpathSync(skillDir) !== skillDir) throw new Error("The skills folder must be inside this workspace.");
      dirs = readdirSync(skillDir, { withFileTypes: true }).filter(entry => entry.isDirectory());
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; dirs = []; }
    if (dirs.length > 64) throw usageError("Select a workspace with up to 64 skill folders.");
    for (const dir of dirs.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const text = boundedFile(join(skillDir, dir.name, "SKILL.md"), SKILL_MAX_BYTES);
      if (text) skills.push({ file: "skill-" + (skills.length + 1) + ".md", text });
    }
  }
  for (const source of notes) {
    const text = boundedFile(join(root, source), 64 * 1024);
    if (!text?.trim()) throw usageError("Note is missing or empty: " + source);
    if (holdsCredential(text)) throw usageError("Remove credentials from the selected note: " + source);
    const sha256 = createHash("sha256").update(text).digest("hex");
    const bytes = Buffer.byteLength(text);
    const duplicate = items.find(item => item.sha256 === sha256);
    if (duplicate) {
      items.push({ source, sha256, bytes, file: duplicate.file, duplicateOf: duplicate.source });
      continue;
    }
    const slug = "openclaw-" + source.slice(0, -3).replace("/", "-").toLowerCase();
    const file = slug + ".md";
    const body = ["---", "name: " + slug, "description: Imported workspace note from " + source, "---",
      "", "Source: OpenClaw " + source, "SHA-256: " + sha256, "", text].join("\n");
    skills.push({ file, text: body });
    items.push({ source, sha256, bytes, file });
  }
  const names = new Set<string>();
  for (const skill of skills) {
    const parsed = parseSkillMd(skill.text);
    if ("error" in parsed) throw usageError(parsed.error);
    if (names.has(parsed.name)) throw usageError("Conflicting skill name: " + parsed.name);
    names.add(parsed.name);
  }
  const outputPath = resolve(destination);
  const out = join(realpathSync(dirname(outputPath)), basename(outputPath));
  const manifest = join(out, "team.json");
  const profile = { name: name && !name.startsWith("(") ? name : basename(root), ...(soul ? { soul } : {}),
    ...(skills.length ? { skills: skills.map(({ file }) => ({ file, enabled: false })) } : {}) };
  const files = [...skills, { file: "team.json", text: JSON.stringify({ version: 1, bots: [profile] }, null, 2) + "\n" }];
  if (items.length) files.push({ file: "openclaw-sources.json", text: JSON.stringify({ version: 1, items }, null, 2) + "\n" });
  const result = { manifest, name: profile.name, skills: skills.length, applied: false, dryRun: options.dryRun === true, items };
  if (options.dryRun) return result;
  try { mkdirSync(out, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !items.length) throw error;
    const actual = readdirSync(out);
    if (realpathSync(out) !== out || actual.length !== files.length || !files.every(({ file, text }) =>
      actual.includes(file) && boundedFile(join(out, file), Buffer.byteLength(text)) === text)) {
      throw usageError("The existing preview differs. Choose a new output directory.");
    }
    loadTeamFile(manifest);
    return result;
  }
  const created: string[] = [];
  try {
    for (const { file, text } of files) {
      const path = join(out, file);
      writeFileSync(path, text, { mode: 0o600, flag: "wx" });
      created.push(path);
    }
    loadTeamFile(manifest);
    return result;
  } catch (error) {
    for (const path of created) unlinkSync(path);
    rmdirSync(out);
    throw error;
  }
}

export async function importOpenClaw(ctx: VerbContext) {
  const [workspace] = ctx.positionals;
  if (!workspace || typeof ctx.flags.out !== "string") throw usageError("Use team import-openclaw WORKSPACE --out NEW_DIRECTORY [--skills] [--notes AGENTS.md,MEMORY.md] [--dry-run].");
  const result = reviewOpenClaw(workspace, ctx.flags.out, ctx.flags.skills === true, {
    notes: typeof ctx.flags.notes === "string" ? ctx.flags.notes : undefined, dryRun: ctx.flags["dry-run"] === true,
  });
  return { result, exitCode: EXIT.done, human: [...result.items.map(item => item.source + "  " + item.sha256 + (item.duplicateOf ? "  duplicate of " + item.duplicateOf : "")),
    result.dryRun ? "Preview only. Omit --dry-run to stage the selected drafts." : result.manifest, "Review the file and use team apply FILE --dry-run to compare it with the current workspace."] };
}
