import { isSkillName } from "../../shared/skill-md.ts";
import { burgerBotOf } from "../../shared/skill-burger/saved.ts";
import { z } from "zod";

import type { SkillsLibrarySkillWire } from "../../shared/wire.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { AppConfig } from "../config.ts";
import { setImportedSkillEnabled } from "../imported-skills.ts";
import { setNativeSkillEnabled } from "../native-skill-choices.ts";
import { botSkillTemplateSchema } from "../new-bot-defaults.ts";
import { fetchSkillFromSource } from "../skill-fetch.ts";
import { skillImportSummary } from "../skill-folder.ts";
import { installLibrarySkill, librarySkillOptOuts, listLibrarySkills, readLibrarySkillFile, readSkillLibraryIndex, setLibrarySkillEveryBot, setLibrarySkillOptOut, setLibrarySkillReviewState, skillsLibraryEnabled, unassignLibrarySkill } from "../skill-library.ts";
import {
  maintainLearnedSkill, installSkill, listBotSkillsWithOrigin, listSkills, listStagedSkillWrites, parseSkillMd, removeSkill, scanSkillText, setSkillEnabled,
  type SkillListing, type StagedSkillWrite,
} from "../skills.ts";
import type { BotRecord, Store } from "../store.ts";
import { skillDependencies, similarLearnedSkills } from "../skill-maintenance.ts";
import type { Routine } from "../routines.ts";
import { learnedSkillUsage } from "../message-db.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BotSkillsRouteDeps {
  store: Store;
  cfg: AppConfig;
  routines?(): Routine[];
  visibleThread?(auth: RequestAuth, threadId: string): boolean;
  visibleBot(auth: RequestAuth, botId: string): boolean;
  listBotSkills(bot: BotRecord, threadId?: string): SkillListing[];
  readBotSkillFile(bot: BotRecord, name: string): string | null;
  stagedSkillListing(staged: StagedSkillWrite): Omit<StagedSkillWrite, "files" | "baseSha256" | "baseAppliedStageId">;
}

export function createBotSkillsRoutes(deps: BotSkillsRouteDeps): RouteHandler {
  const { store, cfg, listBotSkills, readBotSkillFile, stagedSkillListing } = deps;
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const sourceForViewer = (source: string) => {
      const origin = burgerBotOf(source);
      return origin && !deps.visibleBot(auth, origin) ? "skill-burger" : source;
    };
    const skillForViewer = <T extends { source: string }>(skill: T): T => typeof skill.source === "string" ? { ...skill, source: sourceForViewer(skill.source) } : skill;
    let m: RegExpMatchArray | null = null;
    // Imports land DISABLED: a person enables one after reading SKILL.md and its scan warnings.
    m = path.match(/^\/api\/bots\/([\w-]+)\/skill-template$/);
    if (m && method === "POST") {
      if (!store.bot(m[1])) return json(res, 404, { error: "no such bot" });
      const checked = botSkillTemplateSchema.safeParse(await readBody(req));
      if (!checked.success) return json(res, 400, { error: checked.error.message });
      const input = checked.data;
      const parsed = parseSkillMd(input.text);
      if ("error" in parsed || parsed.name !== input.name) return json(res, 400, { error: "Skill name does not match its contents" });
      const installed = installSkill(m[1], input.source, [{ path: "SKILL.md", content: input.text }]);
      if ("error" in installed) return json(res, 422, { error: installed.error });
      if (input.enabled) {
        const enabled = setSkillEnabled(m[1], input.name, true);
        if ("error" in enabled) return json(res, 422, { error: enabled.error });
      }
      return json(res, 201, { installed });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/skills$/);
    if (m && method === "GET") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      // The thread names a folder on disk: only one of this bot's own threads may pick it.
      const asked = url.searchParams.get("threadId");
      const threadId = asked && store.taskByThread(bot.id, asked) ? asked : bot.threadId;
      const present = <T extends SkillListing>(skills: T[]) => {
        const revisions = new Map(skills.flatMap(skill => skill.reviewedRevision ? [[skill.name, skill.reviewedRevision] as const] : []));
        const usage = revisions.size ? learnedSkillUsage.summaries(bot.id, revisions, thread => Boolean(deps.visibleThread?.(auth, thread) && store.taskByThread(bot.id, thread))) : new Map();
        return skills.map(skill => ({ ...skillForViewer(skill), ...(usage.has(skill.name) ? { usage: usage.get(skill.name) } : {}) }));
      };
      if (skillsLibraryEnabled(cfg)) {
        const { skills, library } = listBotSkillsWithOrigin(m[1]!, store.bot(m[1])!.assignedSkills);
        const names = new Set(skills.map((skill) => skill.name));
        return json(res, 200, {
          skills: present([...skills, ...listBotSkills(bot, threadId).filter((skill) => !names.has(skill.name))]),
          library: library.map(skillForViewer),
          assignedSkills: store.bot(m[1])!.assignedSkills,
          staged: listStagedSkillWrites(m[1]).map(stagedSkillListing),
        });
      }
      return json(res, 200, {
        skills: present(listBotSkills(bot, threadId)),
        staged: listStagedSkillWrites(m[1]).map(stagedSkillListing),
      });
    }
    if (m && method === "POST") {
      if (!store.bot(m[1])) return json(res, 404, { error: "no such bot" });
      const parsed = z.object({ source: z.string().min(1).max(2000) }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "source must be a GitHub or skills.sh URL, or owner/repo" });
      const fetched = await fetchSkillFromSource(parsed.data.source);
      if ("error" in fetched) return json(res, 422, { error: fetched.error });
      const results = fetched.skills.map((skill) => ({ skill, result: installSkill(m![1]!, skill.source, skill.files, skill.github) }));
      const errors = results.flatMap(({ result }) => ("error" in result ? [result.error] : []));
      const done = results.flatMap(({ skill, result }) => ("error" in result ? [] : [{ skill, installed: result }]));
      if (!done.length) return json(res, 422, { error: errors.join("; ") || "nothing importable found" });
      const imported = done.map(({ skill, installed }) => skillImportSummary(installed.name, skill.files, skill.skipped));
      return json(res, 201, { installed: done.map(({ installed }) => installed), imported, errors });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/skills\/([a-z0-9-]+)$/);
    if (m && method === "GET") {
      const bot = store.bot(m[1]);
      const text = bot ? readBotSkillFile(bot, m[2]!) : null;
      if (text === null) return json(res, 404, { error: "no such skill" });
      if (url.searchParams.has("maintenance") && bot) {
        const skill = listSkills(bot.id).find(one => one.name === m![2]);
        if (!skill?.reviewedRevision) return json(res, 404, { error: "No reviewed skill." });
        return json(res, 200, { text, revision: skill.reviewedRevision,
          dependencies: [...skillDependencies(skill.name, bot.id, deps.routines?.() ?? [], cfg.newBotDefaults, store.bots)],
          similar: similarLearnedSkills(bot.id, skill.name) });
      }
      return json(res, 200, { text });
    }
    if (m && method === "PATCH") {
      const body = await readBody(req);
      if (body && typeof body === "object" && "maintenance" in body) {
        const input = z.object({ maintenance: z.enum(["pin", "unpin", "archive", "restore"]), revision: z.string().max(129) }).safeParse(body);
        const bot = store.bot(m[1]!);
        if (!bot || !input.success) return json(res, 400, { error: "Choose a reviewed skill revision." });
        const name = m[2]!;
        const referenced = input.data.maintenance === "archive" && (!deps.routines || skillDependencies(name, bot.id, deps.routines(), cfg.newBotDefaults, store.bots).size > 0);
        const result = maintainLearnedSkill(bot.id, name, input.data.revision, input.data.maintenance, referenced);
        return "error" in result ? json(res, 409, result) : json(res, 200, { skill: result });
      }
      const parsed = z.object({ enabled: z.boolean() }).safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "enabled must be true or false" });
      const bot = store.bot(m[1]);
      // A skill from this computer that none of the bot's own or library skills shadows: this bot's switch for it.
      if (bot && listBotSkills(bot).some((skill) => skill.name === m![2] && (skill as { origin?: string }).origin === "imported")) {
        const result = setImportedSkillEnabled(bot.id, m[2]!, parsed.data.enabled);
        if ("error" in result) return json(res, 409, { error: result.error });
        return json(res, 200, { skill: result });
      }
      if (bot && listBotSkills(bot).some((skill) => skill.name === m![2] && "origin" in skill && skill.origin === "native")) {
        const result = setNativeSkillEnabled(bot.id, m[2]!, parsed.data.enabled);
        if ("error" in result) return json(res, 409, { error: result.error });
        const skill = listBotSkills(bot).find((entry) => entry.name === m![2]);
        if (!skill) return json(res, 404, { error: "no such skill" });
        return json(res, 200, { skill });
      }
      const result = setSkillEnabled(m[1]!, m[2]!, parsed.data.enabled);
      if ("error" in result) return json(res, 404, { error: result.error });
      return json(res, 200, { skill: result });
    }
    if (m && method === "DELETE") {
      const bot = store.bot(m[1]!);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const name = m[2]!;
      const removed = removeSkill(bot.id, name);
      if (!("error" in removed)) return json(res, 200, { ok: true });
      if (listSkills(bot.id).some((skill) => skill.name === name)) return json(res, 409, { error: removed.error });
      if (skillsLibraryEnabled(cfg)) {
        const unassigned = unassignLibrarySkill(bot.id, name, bot.assignedSkills);
        if ("unassigned" in unassigned) {
          if ("assignedSkills" in unassigned) store.patchBot(bot.id, { assignedSkills: unassigned.assignedSkills });
          return json(res, 200, { ok: true });
        }
      }
      const origin = (listBotSkills(bot).find((skill) => skill.name === name) as { origin?: string } | undefined)?.origin;
      if (origin === "imported") return json(res, 404, { error: `"${name}" comes from this computer and can't be removed from one bot. Turn it off instead.` });
      if (origin === "native") return json(res, 404, { error: `"${name}" comes from this bot's engine and can't be removed here.` });
      return json(res, 404, { error: removed.error });
    }

    m = path.match(/^\/api\/skills-library$/);
    if (m && method === "GET") {
      if (!skillsLibraryEnabled(cfg)) return json(res, 404, { error: "skills library is not enabled" });
      const index = readSkillLibraryIndex();
      const visibleBots = store.bots.filter((bot) => deps.visibleBot(auth, bot.id));
      const skills: SkillsLibrarySkillWire[] = listLibrarySkills()
        .map((listing): SkillsLibrarySkillWire => ({
          name: listing.name,
          description: listing.description,
          source: sourceForViewer(listing.source),
          enabled: listing.enabled,
          everyBot: index[listing.name]?.everyBot === true,
          tags: listing.tags ?? [],
          version: index[listing.name]?.package?.release ?? null,
          importedAt: listing.importedAt,
          ...(listing.license ? { license: listing.license } : {}),
          ...(listing.compatibility ? { compatibility: listing.compatibility } : {}),
          warnings: listing.warnings,
          assignedBots: visibleBots
            .filter((bot) => bot.assignedSkills?.includes(listing.name) || (index[listing.name]?.everyBot === true && !librarySkillOptOuts(bot.id).has(listing.name)))
            .map((bot) => ({ id: bot.id, name: bot.name })),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return json(res, 200, { skills });
    }
    if (m && method === "POST") {
      if (!skillsLibraryEnabled(cfg)) return json(res, 404, { error: "skills library is not enabled" });
      const parsed = z.object({ text: z.string().min(1) }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "text must be the SKILL.md contents to import" });
      const skill = parseSkillMd(parsed.data.text);
      if ("error" in skill) return json(res, 400, { error: skill.error });
      const installed = installLibrarySkill({
        name: skill.name,
        instructions: parsed.data.text,
        source: "local-import",
        license: skill.license,
        compatibility: skill.compatibility,
        tags: skill.tags,
        warnings: scanSkillText(parsed.data.text),
        reviewState: "disabled",
      });
      if ("error" in installed) return json(res, 422, { error: installed.error });
      return json(res, 201, { skill: installed });
    }
    m = path.match(/^\/api\/skills-library\/([a-z0-9-]+)$/);
    if (m && method === "GET") {
      if (!skillsLibraryEnabled(cfg)) return json(res, 404, { error: "skills library is not enabled" });
      const text = readLibrarySkillFile(m[1]!);
      if (text === null) return json(res, 404, { error: "no such skill" });
      return json(res, 200, { text });
    }
    if (m && method === "PATCH") {
      if (!skillsLibraryEnabled(cfg)) return json(res, 404, { error: "skills library is not enabled" });
      const parsed = z.object({ enabled: z.boolean().optional(), everyBot: z.boolean().optional() })
        .refine((body) => (body.enabled !== undefined) !== (body.everyBot !== undefined)).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "enabled or everyBot must be true or false" });
      const result = parsed.data.enabled !== undefined
        ? setLibrarySkillReviewState(m[1]!, parsed.data.enabled ? "approved" : "disabled")
        : setLibrarySkillEveryBot(m[1]!, parsed.data.everyBot!);
      if ("error" in result) return json(res, 404, { error: result.error });
      return json(res, 200, { skill: skillForViewer(result) });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/skills-library$/);
    if (m && method === "PATCH") {
      if (!skillsLibraryEnabled(cfg)) return json(res, 404, { error: "skills library is not enabled" });
      const parsed = z.object({ name: z.string().refine(isSkillName), assigned: z.boolean() }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "expected a skill name and an assignment" });
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      const { name, assigned } = parsed.data;
      const index = readSkillLibraryIndex();
      if (!Object.hasOwn(index, name)) return json(res, 422, { error: "not in the library" });
      const entry = index[name]!;
      if (assigned) {
        if (!entry.everyBot && !bot.assignedSkills?.includes(name)) {
          if ((bot.assignedSkills?.length ?? 0) >= 200) return json(res, 422, { error: "a bot can have at most 200 assigned skills" });
          store.patchBot(bot.id, { assignedSkills: [...(bot.assignedSkills ?? []), name] });
        }
        setLibrarySkillOptOut(bot.id, name, false);
      } else {
        const removed = unassignLibrarySkill(bot.id, name, bot.assignedSkills);
        if ("assignedSkills" in removed) store.patchBot(bot.id, { assignedSkills: removed.assignedSkills });
      }
      return json(res, 200, { ok: true });
    }
    if (m && method === "PUT") {
      if (!skillsLibraryEnabled(cfg)) return json(res, 404, { error: "skills library is not enabled" });
      if (!store.bot(m[1])) return json(res, 404, { error: "no such bot" });
      const parsed = z.object({ skills: z.array(z.string().min(1).max(64)).max(200) }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "skills must be a list of skill names" });
      const index = readSkillLibraryIndex();
      const names = [...new Set(parsed.data.skills)];
      const unknown = names.filter((name) => !Object.hasOwn(index, name));
      if (unknown.length) return json(res, 422, { error: "not in the library: " + unknown.join(", ") });
      for (const name of names) setLibrarySkillOptOut(m[1]!, name, false);
      store.patchBot(m[1]!, { assignedSkills: names });
      return json(res, 200, { assignedSkills: names });
    }
    return PASS;
  };
}
