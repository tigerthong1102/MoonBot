import { useEffect, useMemo, useState } from "react";

import { askOf, burgerLayers, burgerWorthy, type RunMessage } from "../../../shared/skill-burger/layers";
import { latestRun, runView } from "../../../shared/skill-burger/run-view";
import { fetchBurgerDraft, useRunnable, type DraftView } from "@/lib/skill-burger";
import { RunBurger } from "./RunBurger";
import { layerLine, SkillBurger } from "./SkillBurger";

/** The turn's change to a saved burger's steps, if it made one: the burger's name and the change's Undo. */
export function editIn(messages: readonly RunMessage[]): { id: string; name: string; undo: string } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "user" && message.kind === "text") return null;
    if (message.kind !== "activity" || !/(?:^|__)workflow_edit$/.test(message.tool?.name ?? "") || message.tool?.ok === false) continue;
    const undo = /undo \\?"([0-9a-f-]{36})\\?"/.exec(message.tool?.output ?? "")?.[1];
    let name: unknown;
    try { name = (JSON.parse(message.tool?.input ?? "{}") as { name?: unknown }).name; } catch { name = undefined; }
    if (undo && typeof name === "string") return { id: message.id, name, undo };
  }
  return null;
}

/** The chat dock's burger. While a saved Skill Burger runs (or right after the turn changed one), its steps as the run
 * goes; else the run since the person's last ask, once it has two real steps, ready to save. Either stays until closed. */
export function SkillBurgerSlot({ botId, threadId, busy, canWrite, messages, liveTools, transcriptKey, team = false }: {
  botId: string;
  threadId: string;
  busy: boolean;
  canWrite: boolean;
  messages: readonly RunMessage[];
  liveTools: ReadonlySet<string>;
  transcriptKey: string;
  team?: boolean;
}) {
  const seen = useMemo(() => latestRun(messages, liveTools), [messages, liveTools]);
  const edit = useMemo(() => {
    const found = editIn(messages);
    return found && !latestRun(messages.slice(messages.findIndex((message) => message.id === found.id) + 1), liveTools) ? found : null;
  }, [messages, liveTools]);
  const shownRun = seen && (!edit || seen.name === edit.name) ? seen : null;
  const runnable = useRunnable(edit?.name ?? seen?.name ?? null, botId);
  const layers = useMemo(() => burgerLayers(messages, liveTools), [messages, liveTools]);
  const [closed, setClosed] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [drafts, setDrafts] = useState<ReadonlyMap<string, DraftView | null>>(() => new Map());
  const run = layers[0]?.messageId;
  const finished = !seen && Boolean(run) && burgerWorthy(layers) && !busy && layers.every((layer) => layer.status !== "running");
  const runKey = run ? `${transcriptKey}:${run}:${layers.length}` : "";

  useEffect(() => {
    if (!finished || !runKey || drafts.has(runKey)) return;
    let current = true;
    void fetchBurgerDraft(botId, threadId).then((draft) => {
      if (current) setDrafts((map) => new Map(map).set(runKey, draft));
    });
    return () => { current = false; };
  }, [finished, runKey, botId, threadId, drafts]);

  const close = (key: string) => () => setClosed((current) => new Map(current).set(transcriptKey, key));
  if (seen || edit) {
    const key = edit ? `edit:${edit.id}` : `run:${seen!.run}`;
    if (!runnable || closed.get(transcriptKey) === key) return null;
    const view = runView(runnable.workflow, shownRun, edit?.name ?? seen!.name);
    return (
      <div className="flex justify-end px-4 pb-2">
        <RunBurger key={key} view={view} summary={runnable.workflow.summary} everyChat={runnable.everyChat} botId={botId} threadId={threadId} busy={busy} team={team}
          onDismiss={close(key)} {...(edit ? { edited: { undo: edit.undo } } : {})} />
      </div>
    );
  }
  if (!run || !burgerWorthy(layers) || closed.get(transcriptKey) === run) return null;
  const summary = askOf(messages) ?? layers.map(layerLine).join(", ");
  return (
    <div className="flex justify-end px-4 pb-2">
      <SkillBurger
        key={`${transcriptKey}:${run}`}
        run={`${transcriptKey}:${run}`}
        layers={layers}
        draft={finished ? drafts.get(runKey) ?? null : null}
        summary={summary.slice(0, 160)}
        canSave={canWrite && !busy}
        botId={botId}
        threadId={threadId}
        team={team}
        onDismiss={close(run)}
      />
    </div>
  );
}
