import type { Task } from "./store";

export type TaskUpdatePatch = Partial<Pick<Task, "modelSelection" | "approvalMode" | "autoApprove" | "pinnedMessageId">> & {
  acknowledgeLocalAuto?: boolean;
  updateBotDefault?: boolean;
  resetApprovalToAsk?: boolean;
  projectId?: string | null;
  archivedAt?: number | null;
  snoozedUntil?: number | null;
  doneWhen?: string | null;
  dueDate?: string | null;
  surface?: Task["surface"] | null;
  pinned?: boolean;
  link?: string | null;
};

export function taskPatchFields(patch: TaskUpdatePatch): Partial<Task> {
  const { acknowledgeLocalAuto: _localAck, updateBotDefault: _modelDefault, resetApprovalToAsk, projectId, archivedAt, snoozedUntil, surface, pinned, link, doneWhen, dueDate, ...fields } = patch;
  return { ...fields, ...(resetApprovalToAsk ? { approvalMode: "ask", autoApprove: false, alwaysAllow: [] } : {}),
    ...(projectId === undefined ? {} : { projectId: projectId ?? undefined }),
    ...(archivedAt === undefined ? {} : { archivedAt: archivedAt ?? undefined }),
    ...(doneWhen === undefined ? {} : { doneWhen: doneWhen ?? undefined }),
    ...(dueDate === undefined ? {} : { dueDate: dueDate ?? undefined }),
    ...(snoozedUntil === undefined ? {} : { snoozedUntil: snoozedUntil ?? undefined }),
    ...(surface === undefined ? {} : { surface: surface ?? undefined, surfaceAuto: undefined }),
    ...(pinned === undefined ? {} : { pinned: pinned ? true : undefined }),
    ...(link === undefined ? {} : { link: link ?? undefined }) };
}
