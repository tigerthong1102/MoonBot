import { t } from "@/lib/i18n";
import { WorkflowDisclosure } from "../skill-burger/WorkflowDisclosure";
import type { RoutineRun } from "@/lib/routines";

export function runDiagnostics(run: RoutineRun) {
  const email = run.emailDeliveries?.map(({ state, at }) => ({ state, at }));
  const layer = email?.some(receipt => receipt.state === "unconfirmed") ? "delivery"
    : run.blockedBy === "computer" ? "host"
    : run.blockedBy === "connection" ? "connector"
    : run.blockedBy === "model" || run.ownerCause || run.retried === "provider" ? "engine"
    : run.blockedBy ?? (run.status === "failed" || run.status === "missed" ? "unknown" : undefined);
  return {
    format: "startupbot.routine-diagnostics.v1",
    runId: run.id,
    scheduledFor: run.scheduledFor,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    status: run.status,
    layer,
    blockedBy: run.blockedBy,
    ownerCause: run.ownerCause,
    retryCause: run.retried,
    host: run.runOn,
    target: run.target,
    trigger: run.triggerSource ?? (run.manual ? "manual" : undefined),
    partial: run.partial,
    report: run.report?.state,
    email,
  };
}

export function RunDiagnostics({ run }: { run: RoutineRun }) {
  const report = JSON.stringify(runDiagnostics(run), null, 2);
  return <WorkflowDisclosure title={t("settings.app.diagnostics")}>
    <pre className="my-2 overflow-x-auto whitespace-pre-wrap break-all">{report}</pre>
    <a className="text-accent-text underline" download="startupbot-run-diagnostics.json"
      href={"data:application/json;charset=utf-8," + encodeURIComponent(report)}>{t("attach.download")}</a>
  </WorkflowDisclosure>;
}
