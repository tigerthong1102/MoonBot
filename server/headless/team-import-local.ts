// OpenClaw identity parsing adapted from stablyai/orca src/main/bots/bot-import-sources.ts.
// Copyright (c) 2026 Lovecast Inc., MIT. See public/licenses/orca.txt.
import { constants, closeSync, fstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, unlinkSync, rmdirSync, writeFileSync, type Dirent } from "node:fs";
import { basename, join, resolve } from "node:path";
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
    if (!info.isFile() || info.size > limit || realpathSync(path) !== path) throw new Error("Choose an ordinary file within the size limit: " + basename(path));
    const data = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < data.length) {
      const n = readSync(handle, data, offset, data.length - offset, null);
      if (!n) break;
      offset += n;
    }
    if (offset > limit) throw new Error("File exceeds the import limit: " + basename(path));
    return new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(0, offset));
  } finally { closeSync(handle); }
}

export function reviewOpenClaw(workspace: string, destination: string, includeSkills: boolean) {
  const root = realpathSync(workspace);
  const identity = boundedFile(join(root, "IDENTITY.md"), 16_384);
  const match = identity?.match(/^[\s*-]*\**name\**\s*:\s*\**\s*(.+?)\s*$/im);
  const name = match?.[1]?.replace(/\*+$/, "").trim();
  const soul = boundedFile(join(root, "SOUL.md"), BOT_PROFILE_LIMITS.soul);
  if (!name && !soul) throw usageError("Choose an OpenClaw workspace with IDENTITY.md or SOUL.md.");
  const skills: { file: string; text: string }[] = [];
  if (includeSkills) {
    const skillDir = join(root, "skills");
    let dirs: Dirent[];
    try {
      if (realpathSync(skillDir) !== skillDir) throw new Error("The skills folder must be inside this workspace.");
      dirs = readdirSync(skillDir, { withFileTypes: true }).filter(entry => entry.isDirectory());
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; dirs = []; }
    if (dirs.length > 64) throw usageError("Select a workspace with up to 64 skill folders.");
    for (const dir of dirs) {
      const text = boundedFile(join(skillDir, dir.name, "SKILL.md"), SKILL_MAX_BYTES);
      if (text) skills.push({ file: "skill-" + (skills.length + 1) + ".md", text });
    }
  }
  const out = resolve(destination);
  mkdirSync(out, { mode: 0o700 });
  const created: string[] = [];
  const save = (path: string, text: string) => {
    writeFileSync(path, text, { mode: 0o600, flag: "wx" });
    created.push(path);
  };
  try {
    for (const skill of skills) save(join(out, skill.file), skill.text);
    const profile = { name: name && !name.startsWith("(") ? name : basename(root), ...(soul ? { soul } : {}),
      ...(skills.length ? { skills: skills.map(({ file }) => ({ file, enabled: false })) } : {}) };
    const manifest = join(out, "team.json");
    save(manifest, JSON.stringify({ version: 1, bots: [profile] }, null, 2) + "\n");
    loadTeamFile(manifest);
    return { manifest, name: profile.name, skills: skills.length, applied: false };
  } catch (error) {
    for (const path of created) unlinkSync(path);
    rmdirSync(out);
    throw error;
  }
}

export async function importOpenClaw(ctx: VerbContext) {
  const [workspace] = ctx.positionals;
  if (!workspace || typeof ctx.flags.out !== "string") throw usageError("Use team import-openclaw WORKSPACE --out NEW_DIRECTORY [--skills].");
  const result = reviewOpenClaw(workspace, ctx.flags.out, ctx.flags.skills === true);
  return { result, exitCode: EXIT.done, human: [result.manifest, "Review the file and use team apply FILE --dry-run to compare it with the current workspace."] };
}
