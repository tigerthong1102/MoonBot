// Security: local browse only, with no registry and no network fetch, so an import is exactly the bytes pasted here.
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { intlLocale, t, tFromServer } from "@/lib/i18n";
import { catalogEntry, skillDescription } from "@/lib/library-skill-presentation";
import { activateLibrarySkill } from "@/lib/library-skill-use";
import { offersSkillCommand } from "../../shared/skill-command";
import { useStore } from "@/state/store";
import { Card, Switch } from "./SettingsPrimitives";
import type { SkillsLibrarySkillWire } from "../../shared/wire";
import { Layer } from "./Layer";
import { Select } from "./Select";
import { SkillSourceDialog } from "./SkillSourceDialog";

function skillTags(skill: SkillsLibrarySkillWire): string[] {
  const entry = catalogEntry(skill);
  return entry ? [...new Set([entry.category, ...skill.tags])] : skill.tags;
}

function tagLabel(tag: string): string {
  return tFromServer(`skills.category.${tag}`, tag);
}

function searchText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replaceAll("đ", "d");
}

export function filterLibrarySkills(
  skills: readonly SkillsLibrarySkillWire[],
  query: string,
  tag: string | null,
): SkillsLibrarySkillWire[] {
  const terms = searchText(query).split(/\s+/).filter(Boolean);
  return skills.filter((skill) => {
    const tags = skillTags(skill);
    if (tag && !tags.includes(tag)) return false;
    if (!terms.length) return true;
    const text = searchText([skill.name, skill.description, skill.source, skill.license, catalogEntry(skill)?.summaryVi, skillDescription(skill), ...tags, ...tags.map(tagLabel)].join(" "));
    return terms.every((term) => text.includes(term));
  });
}

export function LibrarySkillMeta({ skill }: { skill: SkillsLibrarySkillWire }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-secondary">
      <span>{skill.version ? t("skills.library.version", { version: skill.version }) : t("skills.library.noVersion")}</span>
      <span>{t("skills.library.importedAt", { date: new Date(skill.importedAt).toLocaleDateString(intlLocale()) })}</span>
      {skill.license && <span>{skill.license}</span>}
      {skillTags(skill).map((tag) => (
        <span key={tag} className="rounded bg-control px-1.5 py-0.5 font-mono">{tagLabel(tag)}</span>
      ))}
    </div>
  );
}

export interface SkillChatTarget {
  botId: string;
  threadId: string;
  use: (name: string) => void;
}

export function SkillsSection({ chat }: { chat?: SkillChatTarget } = {}) {
  const { state } = useStore();
  const [skills, setSkills] = useState<SkillsLibrarySkillWire[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ skill: SkillsLibrarySkillWire; text: string; review: boolean } | null>(null);
  const [working, setWorking] = useState("");
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [assignBot, setAssignBot] = useState("");
  const busy = useRef(false);

  const bots = state.bots.filter((bot) => !bot.hidden);
  const tags = useMemo(
    () => [...new Set(skills.flatMap(skillTags))].sort((a, b) => a.localeCompare(b)),
    [skills],
  );
  const visible = filterLibrarySkills(skills, query, activeTag);

  const refresh = async (cancelled?: () => boolean) => {
    try {
      const response = await fetch("/api/skills-library");
      const body = (await response.json()) as { skills?: SkillsLibrarySkillWire[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? t("skills.library.loadError"));
      if (cancelled?.()) return;
      setSkills(body.skills ?? []);
      setError("");
    } catch (cause) {
      if (!cancelled?.()) setError(cause instanceof Error ? cause.message : t("skills.library.loadError"));
    } finally {
      if (!cancelled?.()) setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void refresh(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, []);

  const putAssignments = async (botId: string, name: string, remove: boolean) => {
    if (busy.current) return;
    busy.current = true;
    const label = `${name}:${botId}`;
    setWorking(label);
    setError("");
    try {
      const response = await fetch(`/api/bots/${encodeURIComponent(botId)}/skills-library`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, assigned: !remove }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? t("skills.error.assignments"));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("skills.error.assignments"));
    } finally {
      busy.current = false;
      setWorking("");
    }
  };

  const assign = async (skill: SkillsLibrarySkillWire) => {
    if (!assignBot) return;
    await putAssignments(assignBot, skill.name, false);
  };

  const unassign = async (skill: SkillsLibrarySkillWire, botId: string) => {
    await putAssignments(botId, skill.name, true);
  };

  const toggle = async (skill: SkillsLibrarySkillWire, reviewed = false) => {
    if (busy.current) return;
    if (!skill.enabled && !reviewed) return view(skill, true);
    busy.current = true;
    setWorking(skill.name);
    setError("");
    try {
      const response = await fetch(`/api/skills-library/${encodeURIComponent(skill.name)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !skill.enabled }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? t("skills.error.update"));
      if (reviewed) setViewing(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("skills.error.update"));
    } finally {
      busy.current = false;
      setWorking("");
    }
  };

  const toggleEveryBot = async (skill: SkillsLibrarySkillWire) => {
    if (busy.current) return;
    busy.current = true;
    setWorking(skill.name);
    setError("");
    try {
      const response = await fetch(`/api/skills-library/${encodeURIComponent(skill.name)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ everyBot: !skill.everyBot }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not update this skill.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this skill.");
    } finally {
      busy.current = false;
      setWorking("");
    }
  };

  const view = async (skill: SkillsLibrarySkillWire, review = false) => {
    setError("");
    try {
      const response = await fetch(`/api/skills-library/${encodeURIComponent(skill.name)}`);
      const body = (await response.json()) as { text?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? t("skills.error.load"));
      if (!body.text) throw new Error(t("skills.error.contentsImport"));
      setViewing({ skill, text: body.text, review });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("skills.error.load"));
    }
  };

  const useInChat = async (skill: SkillsLibrarySkillWire, reviewed = false) => {
    if (!chat || busy.current) return;
    if (!skill.enabled && !reviewed) return view(skill, true);
    busy.current = true;
    setError("");
    setWorking(skill.name);
    try {
      await activateLibrarySkill(chat, skill);
      chat.use(skill.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("skills.library.unavailable"));
    } finally {
      busy.current = false;
      setWorking("");
    }
  };

  const importSkill = async () => {
    const text = importText.trim();
    if (!text) return;
    setImporting(true);
    setError("");
    setImportMessage("");
    try {
      const response = await fetch("/api/skills-library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = (await response.json()) as { skill?: { name: string }; error?: string };
      if (!response.ok) throw new Error(body.error ?? t("skills.error.import"));
      setImportMessage(t("skills.library.imported", { name: body.skill?.name ?? "" }));
      setImportText("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("skills.error.import"));
    } finally {
      setImporting(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none";

  return (
    <div className="flex flex-col gap-4">
      <Card subtitle={chat ? undefined : t("skills.library.subtitle")}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Search size={15} className="shrink-0 text-ink-secondary" />
            <input
              className={inputClass}
              placeholder={t("skills.library.searchPlaceholder")}
              aria-label={t("skills.library.searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {skills.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                aria-pressed={activeTag === null && !query}
                onClick={() => { setActiveTag(null); setQuery(""); }}
                className={
                  activeTag === null && !query
                    ? "rounded-full bg-control px-2.5 py-1 text-[12px] font-medium text-ink"
                    : "rounded-full px-2.5 py-1 text-[12px] text-ink-secondary hover:bg-control/50 hover:text-ink"
                }
              >
                {t("skills.library.allTags")} ({skills.length})
              </button>
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={activeTag === tag}
                  onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                  className={
                    activeTag === tag
                      ? "rounded-full bg-control px-2.5 py-1 font-mono text-[12px] font-medium text-ink"
                      : "rounded-full px-2.5 py-1 font-mono text-[12px] text-ink-secondary hover:bg-control/50 hover:text-ink"
                  }
                >
                  {tagLabel(tag)}
                </button>
              ))}
            </div>
          )}

          {!loading && !error && <p role="status" className="text-[12px] text-ink-secondary">{t("skills.library.count", { shown: visible.length, total: skills.length })}</p>}
          {loading ? (
            <div className="text-[12px] text-ink-secondary">{t("skills.library.loading")}</div>
          ) : visible.length === 0 ? (
            <div className="rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary">
              {skills.length === 0 ? t("skills.library.empty") : t("skills.library.noMatches")}
            </div>
          ) : (
            <div className="divide-y divide-hairline/40 overflow-hidden rounded-lg border border-hairline/40">
              {visible.map((skill) => (
                <div key={skill.name} data-library-skill={skill.name} className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => void view(skill)} className="min-w-0 flex-1 text-left" aria-label={t("skills.library.view", { skill: skill.name })} aria-describedby={`library-description-${skill.name}`}>
                      <div className="truncate font-mono text-[13px] text-ink">{skill.name}</div>
                      <div id={`library-description-${skill.name}`} className="mt-0.5 break-words text-[12px] text-ink-secondary">{skillDescription(skill)}</div>
                    </button>
                    {chat ? (
                      <button type="button" disabled={Boolean(working) || !offersSkillCommand(skill.name)}
                        aria-describedby={`library-description-${skill.name}`} onClick={() => void useInChat(skill)}
                        className="shrink-0 rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50">
                        {t("skills.library.useInChat")}
                      </button>
                    ) : (
                      <Switch
                        checked={skill.enabled}
                        aria-label={skill.enabled ? t("skills.library.disable", { skill: skill.name }) : t("skills.library.enable", { skill: skill.name })}
                        disabled={Boolean(working || importing)}
                        onClick={() => void toggle(skill)}
                      />
                    )}
                  </div>
                  <LibrarySkillMeta skill={skill} />
                  {!chat && <>
                    <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-inset px-2.5 py-2">
                      <div>
                        <div className="text-[12px] font-medium text-ink">{t("skills.library.everyBot")}</div>
                        <div className="text-[11px] text-ink-secondary">{t("skills.library.everyBotHint")}</div>
                      </div>
                      <Switch
                        checked={skill.everyBot}
                        aria-label={t("skills.library.everyBot")}
                        disabled={Boolean(working || importing)}
                        onClick={() => void toggleEveryBot(skill)}
                      />
                    </div>
                    {skill.warnings.length > 0 && (
                      <div className="mt-1 text-[11px] text-warning">{skill.warnings.join(" · ")}</div>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-secondary">
                      {skill.assignedBots.length === 0 ? (
                        <span>{t("skills.library.notAssigned")}</span>
                      ) : (
                        skill.assignedBots.map((bot) => (
                          <span key={bot.id} className="flex items-center gap-1 rounded-full bg-control px-2 py-0.5">
                            <span className="max-w-40 truncate">{bot.name}</span>
                            <button
                              type="button"
                              aria-label={t("skills.library.removeAssignment", { bot: bot.name })}
                              title={t("skills.library.removeAssignment", { bot: bot.name })}
                              disabled={Boolean(working || importing)}
                              onClick={() => void unassign(skill, bot.id)}
                              className="flex size-4 items-center justify-center rounded-full text-ink-secondary hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                            >
                              <X size={11} />
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                    {bots.length > 0 && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <Select
                          size="sm"
                          aria-label={t("skills.library.assignLabel")}
                          value={assignBot}
                          disabled={Boolean(working || importing)}
                          onChange={(e) => setAssignBot(e.target.value)}
                          className="max-w-45"
                        >
                          <option value="">{t("skills.library.assignPickBot")}</option>
                          {bots.map((bot) => (
                            <option key={bot.id} value={bot.id}>{bot.name}</option>
                          ))}
                        </Select>
                        <button
                          type="button"
                          disabled={!assignBot || !skill.enabled || skill.assignedBots.some((bot) => bot.id === assignBot) || Boolean(working || importing)}
                          onClick={() => void assign(skill)}
                          className="rounded-lg bg-control px-2.5 py-1 text-[12px] text-ink hover:bg-raised-hover disabled:opacity-50"
                        >
                          {t("skills.library.assign")}
                        </button>
                      </div>
                    )}
                  </>}
                </div>
              ))}
            </div>
          )}
          {error && <div role="alert" className="mt-2 text-[12px] text-danger">{error}</div>}
        </div>
      </Card>

      {!chat && <Card title={t("skills.library.importTitle")} subtitle={t("skills.library.importHint")}>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void importSkill();
          }}
        >
          <textarea
            className={`${inputClass} min-h-32 font-mono text-[12px]`}
            placeholder={t("skills.library.importPlaceholder")}
            aria-label={t("skills.library.importTitle")}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <div className="flex items-center justify-between gap-2">
            {importMessage ? <div className="text-[12px] text-ink-secondary">{importMessage}</div> : <span />}
            <button
              type="submit"
              disabled={importing || Boolean(working) || !importText.trim()}
              className="shrink-0 rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
            >
              {importing ? t("skills.library.importing") : t("skills.library.importButton")}
            </button>
          </div>
        </form>
      </Card>}

      {viewing && <Layer modal><SkillSourceDialog viewing={viewing} details={<LibrarySkillMeta skill={viewing.skill} />} error={error} working={Boolean(working)} onClose={() => { if (!working) setViewing(null); }} enableLabel={chat ? t("skills.library.enableAndUse") : t("skills.enableReviewed")} onEnable={() => void (chat ? useInChat(viewing.skill, true) : toggle(viewing.skill, true))} /></Layer>}
    </div>
  );
}
