import { t } from "@/lib/i18n";
import { useStore, type Task, type TaskUpdatePatch } from "@/state/store";
import { useRef } from "react";

export function TodayTaskDetails({ task, botId }: { task: Task; botId: string }) {
  const { dispatch } = useStore();
  const box = useRef<HTMLDetailsElement>(null);
  const field = "w-full rounded-md border border-hairline bg-card px-2 py-1 text-ink";
  const update = (patch: TaskUpdatePatch) => dispatch({ type: "updateTask", threadId: task.threadId, botId, patch });
  return <details ref={box} className="mx-2 mb-2 text-[12px] text-ink-secondary">
    <summary className="cursor-pointer">{t("botPanel.tab.details")}{task.dueDate && <> · <time dateTime={task.dueDate}>{task.dueDate}</time></>}</summary>
    <form key={JSON.stringify([task.dueDate, task.doneWhen, task.link])} className="mt-2 grid gap-2" onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const patch: TaskUpdatePatch = {};
      for (const key of ["doneWhen", "dueDate", "link"] as const) {
        const value = String(data.get(key) ?? "").trim();
        if (value !== (task[key] ?? "")) patch[key] = value || null;
      }
      if (Object.keys(patch).length) update(patch);
      if (box.current) box.current.open = false;
    }}>
      <label>{t("today.criteria")}<textarea className={field} name="doneWhen" maxLength={2000} defaultValue={task.doneWhen} /></label>
      <label>{t("today.dueDate")}<input className={field} name="dueDate" type="date" defaultValue={task.dueDate} /></label>
      <label>{t("task.link")}<input className={field} name="link" type="url" maxLength={2048} defaultValue={task.link} /></label>
      <div className="flex justify-between gap-2">
        <button type="button" onClick={() => {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(9, 0, 0, 0);
          update({ snoozedUntil: tomorrow.getTime() });
        }}>{t("task.snoozeTomorrow")}</button>
        <button type="submit" className="rounded-md bg-accent px-3 py-1 text-accent-ink">{t("common.save")}</button>
      </div>
    </form>
  </details>;
}
