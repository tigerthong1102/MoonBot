import { WorkflowDisclosure } from "./WorkflowDisclosure";
import { useState } from "react";
import { parallelRead, workflowSchema, type WorkflowStep } from "../../../shared/skill-burger/format";
import { Select } from "../Select";
import { t } from "@/lib/i18n";
import { readBurgerRevision, saveBurgerControls, type SavedWorkflow } from "@/lib/skill-burger";

export type StepControls = Pick<WorkflowStep, "id" | "when" | "approval" | "parallelWithPrevious">;
const field = "w-full rounded-md border border-hairline/50 bg-card px-2 py-1 text-sm text-ink";

export function WorkflowControls({ skill, team }: { skill: SavedWorkflow; team: boolean }) {
  const [steps, setSteps] = useState<WorkflowStep[] | null>(null);
  const [sha, setSha] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const [dirty, setDirty] = useState(false);
  const report = (err: unknown) => setError(err instanceof Error ? err.message : String(err));
  const load = async () => {
    setBusy(true); setError("");
    try {
      const revision = await readBurgerRevision(skill);
      setSteps(workflowSchema.parse(revision.workflow).steps);
      setSha(revision.sha256); setDirty(false); setConsent(false);
    } catch (err) { report(err); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!steps) return;
    setBusy(true); setError("");
    try {
      const controls = steps.map(({ id, approval, when, parallelWithPrevious }) => ({ id, approval, when, parallelWithPrevious }));
      const saved = await saveBurgerControls(skill, sha, controls, team && consent);
      setSha(saved.sha256); setDirty(false); setConsent(false);
    } catch (err) { report(err); }
    finally { setBusy(false); }
  };
  function change(index: number, patch: Partial<StepControls>) {
    setSteps(before => before?.map((step, i) => i === index ? { ...step, ...patch } : step) ?? null);
    setDirty(true); setError("");
  }
  return <WorkflowDisclosure title={t("workflow.controls")} onOpen={() => { if (!steps && !busy) void load(); }}>
    {steps?.map((step, index) => <fieldset key={step.id} disabled={busy} className="my-2 space-y-2 rounded-lg border border-hairline/50 p-2">
      <legend>{step.label}</legend>
      <label className="block">{t("workflow.approvalPrompt")}
        <input className={field} maxLength={500} value={step.approval ?? ""} onChange={e => change(index, { approval: e.target.value || undefined })} />
      </label>
      {index > 0 && <label className="block">{t("workflow.when")}
        <Select value={step.when?.$step ?? ""} onChange={e => change(index, { when: e.target.value ? { $step: e.target.value, op: "exists" } : undefined })}>
          <option value="">{t("workflow.always")}</option>
          {steps.slice(0, index).map(prev => <option key={prev.id} value={prev.id}>{prev.label}</option>)}
        </Select>
      </label>}
      {step.when && <>
        <label className="block">{t("workflow.path")}<input className={field} maxLength={200} value={step.when.path ?? ""} onChange={e => change(index, { when: { ...step.when!, path: e.target.value || undefined } })} /></label>
        <Select aria-label={t("workflow.when")} value={step.when.op} onChange={e => change(index, { when: { ...step.when!, op: e.target.value as NonNullable<WorkflowStep["when"]>["op"] } })}>
          <option value="exists">{t("workflow.exists")}</option><option value="eq">=</option><option value="ne">≠</option><option value="gt">&gt;</option><option value="lt">&lt;</option>
        </Select>
        {step.when.op !== "exists" && <label className="block">{t("skillBurger.draft.inputValue")}<input className={field} maxLength={500} value={typeof step.when.value === "string" ? step.when.value : JSON.stringify(step.when.value) ?? ""}
          onChange={e => change(index, { when: { ...step.when!, value: e.target.value } })} /></label>}
      </>}
      {index > 0 && (step.parallelWithPrevious || (parallelRead(step) && parallelRead(steps[index - 1]))) && <label className="flex items-center gap-2">
        <input type="checkbox" checked={!!step.parallelWithPrevious} onChange={e => change(index, { parallelWithPrevious: e.target.checked || undefined })} />{t("workflow.parallel")}
      </label>}
    </fieldset>)}
    {steps && <div className="flex flex-col gap-2">
      {team && <label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> {t("workflow.share")}</label>}
      <button type="button" disabled={busy || !dirty || (team && !consent)} className="ui-button ui-button-md self-start" onClick={() => void save()}>{t("common.save")}</button>
    </div>}
    {error && <p role="alert">{error} <button type="button" onClick={() => void load()}>{t("chat.retry")}</button></p>}
  </WorkflowDisclosure>;
}
