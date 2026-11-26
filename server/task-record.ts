import { approvalModeFor } from "../shared/approval-mode.ts";
import { sameModelSelection } from "../shared/thread-model.ts";
import type { TaskOpenedBy, WireTask } from "../shared/wire.ts";
import { newId, type ModelSelection } from "./contracts.ts";
import type { BotRecord, TaskRecord } from "./store.ts";

export function toWireTask(task: TaskRecord, botModel: ModelSelection): WireTask {
  const { resumeCursors: _resumeCursors, lastInstanceId: _lastInstanceId, handedMessages: _handedMessages,
    appliedCompactionId: _appliedCompactionId, contextFloor: _contextFloor, lastContextModel: _lastContextModel,
    surfaceSource, askedAt: _askedAt, ...stored } = task;
  const wire: WireTask = { ...stored, modelSelection: structuredClone(task.modelSelection ?? botModel), followsBotModel: task.modelSelection === undefined };
  return surfaceSource === "auto" && wire.surface !== undefined ? { ...wire, surfaceAuto: true } : wire;
}

export const UNTITLED_THREAD = "New thread";
const TASK_TITLE_MAX = 80;

export function threadTitleFrom(title?: string): string {
  return title?.trim().slice(0, TASK_TITLE_MAX) || UNTITLED_THREAD;
}

export function buildTask(bot: BotRecord, title?: string, projectId?: string, openedBy?: TaskOpenedBy,
  approvalMode?: "ask" | "full", modelSelection?: ModelSelection, cwd?: string | null): TaskRecord {
  const createdAt = Date.now();
  return {
    threadId: newId(),
    title: threadTitleFrom(title),
    createdAt,
    updatedAt: createdAt,
    ...(cwd !== undefined ? { cwd } : {}),
    ...(projectId ? { projectId } : {}),
    ...(openedBy ? { openedBy: structuredClone(openedBy) } : {}),
    resumeCursors: {},
    ...(modelSelection && !sameModelSelection(modelSelection, bot.modelSelection) ? { modelSelection: structuredClone(modelSelection) } : {}),
    approvalMode: approvalMode ?? approvalModeFor(bot),
    autoApprove: approvalMode ? false : Boolean(bot.autoApprove),
    alwaysAllow: approvalMode ? [] : [...(bot.alwaysAllow ?? [])],
    unread: false,
    activity: "idle",
    busy: false,
  };
}

export function mirrorActiveTask(bot: BotRecord, task: TaskRecord) {
  bot.threadId = task.threadId;
  bot.resumeCursors = structuredClone(task.resumeCursors);
  bot.rewound = task.rewound;
  bot.pinnedMessageId = task.pinnedMessageId;
}
