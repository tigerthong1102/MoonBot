import { isStopCommand } from "../room-holds.ts";
import { serverLine } from "../server-lines.ts";
import type { Message, Store } from "../store.ts";
import { handedRunTarget, hasUncertainWorkBotStop } from "./work-bot-host.ts";
import type { TypedStop } from "./person-stop.ts";
import type { Actor } from "./run-owner.ts";

type Owner = { messageId?: string; stopped?: boolean };
type Target = { botId: string; threadId: string };

export function createWorkBotTypedStop(deps: {
  store: Store;
  team: boolean;
  busy(botId: string, threadId: string): boolean;
  ownerFor(threadId: string): Owner | undefined;
  refusal(threadId: string, by: Actor): string | null;
  activeRoutine(target: Target): boolean;
  stop: (botId: string, threadId: string, sender?: Message["sender"]) => Promise<void>;
  stopTyped: (input: TypedStop) => Promise<{ ok: true; threadId: string; message: Message } | null>;
  language(threadId: string): string | undefined;
}) {
  const eligible = (input: TypedStop) => !deps.team && !input.fromApp && (input.trigger.kind === "user" || input.trigger.kind === "owner");
  const failure = (threadId: string) => Object.assign(new Error(serverLine(deps.language(threadId), "server.workBot.stopInAssignedBot")), { status: 409, code: "work_bot_stop_uncertain" });
  const isStop = (input: TypedStop) => isStopCommand(input.text, deps.store.bot(input.botId)?.name);
  function assertSafe(input: TypedStop): void {
    if (eligible(input) && hasUncertainWorkBotStop(deps.store.messagesFor(input.threadId), input.row.sendId, isStop(input))) throw failure(input.threadId);
  }
  async function stop(input: TypedStop) {
    const { botId, threadId } = input;
    const source = deps.store.activePath(threadId).findLast(row => row.role === "user");
    if (eligible(input) && source?.workBotRouting?.stopPending && isStop(input)) throw failure(threadId);
    const target = !deps.team && handedRunTarget(deps.store, deps.busy, deps.ownerFor, botId, threadId);
    const owner = target ? deps.ownerFor(target.threadId) : undefined;
    let attempted = false;
    const result = await deps.stopTyped({ ...input, busy: input.busy || Boolean(target), ...(target && owner ? { stopHandoff: async () => {
      const current = deps.ownerFor(target.threadId);
      if (current !== owner || current.stopped || !current.messageId) throw Object.assign(new Error("The handed-off work changed before it could be stopped"), { status: 409 });
      const refusal = deps.refusal(target.threadId, input.by ?? { admin: false });
      if (refusal) throw Object.assign(new Error(refusal), { status: 403, code: "stop_not_yours" });
      if (deps.activeRoutine(target)) throw Object.assign(new Error("Another run is active in the assigned conversation; open it to stop the intended work"), { status: 409 });
      if (!source?.workBotRouting || !deps.store.patchMessage(threadId, source.id, { workBotRouting: { ...source.workBotRouting, stopPending: input.row.sendId ? { sendId: input.row.sendId } : {} } })) throw Object.assign(new Error("The handed-off work is no longer available"), { status: 409 });
      attempted = true;
      await deps.stop(target.botId, target.threadId, input.row.sender);
    } } : {}) });
    if (result && attempted && source) {
      const latest = deps.store.messagesFor(threadId).find(row => row.id === source.id);
      if (latest?.workBotRouting?.stopPending) deps.store.patchMessage(threadId, latest.id, { workBotRouting: { ...latest.workBotRouting, stopPending: undefined } });
    }
    return result;
  }
  return { assertSafe, stop };
}
