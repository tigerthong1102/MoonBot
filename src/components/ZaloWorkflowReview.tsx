import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { effectivePlace } from "@/lib/place";
import { api } from "@/state/api";
import { visibleMessages } from "@/state/snapshot-navigation";
import { currentTaskBot, useStore, type Bot } from "@/state/store";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { usePlaceViews } from "./PlaceChip";
import { Select } from "./Select";
import { SETTINGS_INPUT, SettingsField } from "./SettingsPrimitives";

interface ReviewedWorkflow { name: string; summary: string; sha256: string; steps: string[]; inputs: string[] }
type Result = { workflows: ReviewedWorkflow[] };
type Status = "loading" | "ready" | "failed" | "changed" | "prepared";

export default function ZaloWorkflowReview({ bot, source, line }: { bot: Bot; source: string; line: number }) {
  const { state, dispatch } = useStore();
  const { capabilities, ready } = useDesktopCapabilities();
  const { local } = usePlaceViews(currentTaskBot(bot));
  const [workflows, setWorkflows] = useState<ReviewedWorkflow[]>([]);
  const [choice, setChoice] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [windows, setWindows] = useState(false);
  const [reload, setReload] = useState(0);
  const [checking, setChecking] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const selected = workflows.find(item => item.sha256 + ":" + item.name === choice);
  const place = effectivePlace(bot, bot.tasks?.find(task => task.threadId === bot.threadId));
  const host = capabilities.host;
  const available = ready && state.connected && state.selectedId === bot.id && !bot.switchingTo && place === "local"
    && local.reachable && capabilities.localComputer.available && capabilities.localComputer.enabled
    && (!windows || host.platform === "win32");
  const current = useRef(false);
  current.current = available;
  useEffect(() => {
    if (available || !pending.current) return;
    pending.current.abort();
    pending.current = null;
    setChecking(false);
  }, [available]);
  const endpoint = "/api/zalo-workflow-review/" + encodeURIComponent(bot.id);
  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setWorkflows([]);
    setChoice("");
    void api<Result>(endpoint, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) { setWorkflows(result.workflows); setStatus("ready"); }
    }).catch(() => { if (!controller.signal.aborted) setStatus("failed"); });
    return () => { controller.abort(); pending.current?.abort(); };
  }, [endpoint, reload]);

  async function confirm(open: boolean) {
    if (!available || !selected || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setChecking(true);
    try {
      const { workflows: fresh } = await api<Result>(endpoint, { signal: controller.signal });
      if (controller.signal.aborted || !current.current) return;
      if (!fresh.some(item => item.name === selected.name && item.sha256 === selected.sha256)) { setStatus("changed"); return; }
      if (open) {
        dispatch({ type: "showSkillBurgers", reviewed: { botId: bot.id, threadId: bot.threadId, name: selected.name, sha256: selected.sha256 } });
      } else {
        setStatus("prepared");
      }
    } catch { if (!controller.signal.aborted) setStatus("failed"); }
    finally { if (!controller.signal.aborted) { pending.current = null; setChecking(false); } }
  }

  function openChat(messageId?: string) {
    dispatch({ type: "toggleAppSettings", open: false });
    dispatch({ type: "toggleSettings", open: false });
    dispatch({ type: "showChat" });
    if (messageId) dispatch({ type: "focusMessage", threadId: bot.threadId, messageId });
  }

  const saved = visibleMessages(bot)?.findLast(message => message.savedSteps?.learned || message.savedSteps?.replayed);
  return <section className="flex flex-col items-start gap-2 border-l border-hairline pl-3" aria-label={t("zalo.workflow.review")}>
    <p>{t("zalo.workflow.source", { source, line })}</p>
    <p>{t("zalo.workflow.scope")}</p>
    <label><input type="checkbox" disabled={checking || status === "prepared"} checked={windows} onChange={event => setWindows(event.target.checked)} /> {t("zalo.workflow.windows")}</label>
    <p role="status">{available ? t("zalo.workflow.available", { host: host.label }) : t("zalo.workflow.unavailable")}</p>
    {saved && <button type="button" className="ui-button" onClick={() => openChat(saved.id)}>{t("zalo.workflow.savedSteps")}</button>}
    {status === "loading" ? <p role="status">{t("skills.loading")}</p> : status === "failed" || status === "changed" ?
      <><p role="alert">{t(status === "changed" ? "zalo.workflow.changed" : "skillBurger.list.loadFailed")}</p>
        <button type="button" className="ui-button" onClick={() => setReload(value => value + 1)}>{t("common.tryAgain")}</button></> :
      status === "prepared" ? <><p dir="auto">{selected?.summary}</p><p role="status">{t("zalo.workflow.prepared")}</p>
        <button className="ui-button" type="button" disabled={!available || checking} onClick={() => void confirm(true)}>{t("zalo.workflow.openChat")}</button></> :
        !workflows.length ? <p role="status">{t("zalo.workflow.empty")}</p> : <>
          <SettingsField label={t("skillBurger.list.title")}><Select className={SETTINGS_INPUT} disabled={checking} value={choice}
            onChange={event => { setChoice(event.target.value); setStatus("ready"); }}>
            <option value="">{t("zalo.workflow.choose")}</option>
            {workflows.map(item => <option key={item.name} value={item.sha256 + ":" + item.name}>{item.summary}</option>)}
          </Select></SettingsField>
          {selected && <><p dir="auto">/{selected.name}</p><ol className="list-decimal pl-5">{selected.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
            {selected.inputs.length > 0 && <p>{t("zalo.workflow.inputs", { inputs: selected.inputs.join(", ") })}</p>}
            <button type="button" className="ui-button" disabled={!available || checking} onClick={() => void confirm(false)}>{t("zalo.workflow.prepare")}</button></>}
        </>}
  </section>;
}
