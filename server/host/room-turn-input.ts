import { mentionedBots, type BotRecord, type Store, type GroupRecord } from "../store.ts";
import type { ResolvedSender } from "../../shared/wire.ts";
import { serverLine } from "../server-lines.ts";
import type { ReplyTarget } from "../replies.ts";
import type { RoomPick } from "../room-pointed.ts";
import type { ChannelQueueItem } from "../channel-queue.ts";
import type { UsageTrigger } from "../usage-ledger.ts";

export type StartGroupTurnOptions = {
  threadId?: string;
  goalCoordinatorBotId?: string;
  goalRunId?: string; mentions?: string[];
  via?: "api";
  sender?: ResolvedSender;
  trigger?: UsageTrigger;
  queuedGroup?: ChannelQueueItem[]; /** What the person pointed at in a member's page: the page's bot reads it on its turn, and the line shows the chips. */ pointed?: RoomPick;
};

export function roomTurnTarget(store: Store, groupId: string, askedThread: string | undefined, roomSetupPending: (group: GroupRecord) => boolean) {
  const group = store.group(groupId);
  if (!group) throw Object.assign(new Error("no such group"), { status: 404 });
  if (roomSetupPending(group)) {
    throw Object.assign(new Error("finish room setup before sending the first message"), { status: 409 });
  }
  const threadId = askedThread ?? group.threadId;
  const ownsThread = group.dm
    ? group.threadId === threadId
    : Boolean(store.groupTaskByThread(group.id, threadId));
  if (!ownsThread) {
    throw Object.assign(new Error("no such room task"), { status: 404 });
  }
  const members = group.memberIds
    .map((id) => store.bot(id))
    .filter((bot): bot is NonNullable<typeof bot> => Boolean(bot));
  return { group, threadId, members };
}

export function appendRoomInput(store: Store, threadId: string, text: string, channelMode: "chat" | "goal",
  options: StartGroupTurnOptions, replyTo?: ReplyTarget, sendId?: string, queueId?: string) {
  const queuedGroup = options.queuedGroup;
  return queuedGroup && queuedGroup.length > 0
    ? (() => {
        for (const item of queuedGroup.slice(0, -1)) {
          store.appendMessage(threadId, {
            role: "user",
            kind: "text",
            text: item.text,
            replyToId: item.replyToId,
            reaction: item.reaction,
            sendId: item.sendId,
            channelMode: item.mode,
            queueId: item.id,
            via: item.via,
            sender: item.sender, ...(item.pointed ? { pointed: item.pointed.refs } : {}),
          });
        }
        const last = queuedGroup[queuedGroup.length - 1]!;
        return store.appendMessage(threadId, {
          role: "user",
          kind: "text",
          text: last.text,
          replyToId: replyTo?.id,
          reaction: last.reaction,
          sendId: last.sendId,
          channelMode: last.mode,
          queueId: last.id,
          via: last.via,
          sender: last.sender, ...(last.pointed ? { pointed: last.pointed.refs } : {}),
        });
      })()
    : store.appendMessage(threadId, {
        role: "user",
        kind: "text",
        text,
        replyToId: replyTo?.id,
        reaction: replyTo?.reactedWith,
        sendId,
        channelMode,
        queueId,
        via: options.via,
        sender: options.sender, ...(options.pointed ? { pointed: options.pointed.refs } : {}),
      });
}

export function noteAbsentRoomMembers(store: Store, threadId: string, text: string, members: BotRecord[], elsewhere: string[], language?: string) {
  const archived = members.filter((member) => member.hidden);
  const mentionedArchived = mentionedBots(text, archived.map(({ name }) => ({ name })))[0];
  for (const line of elsewhere) store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: line, ok: false } });
  if (mentionedArchived) {
    store.appendMessage(threadId, {
      role: "bot",
      kind: "activity",
      tool: {
        name: serverLine(language, "server.rooms.archived", { bot: mentionedArchived.name }),
        ok: false,
      },
    });
  }
  return { archived, mentionedArchived };
}

export function noteUnavailableResponder(store: Store, threadId: string, responder: GroupRecord["defaultResponder"], archived: BotRecord[], mentionedArchived: boolean, hasActive: boolean, language?: string) {
    const defaultArchivedId = responder.kind === "member" ? responder.botId : undefined;
    const defaultArchived = archived.find((member) => member.id === defaultArchivedId);
    let unavailableMessage: string | undefined;
    if (!mentionedArchived && !hasActive) {
      unavailableMessage = serverLine(language, "server.rooms.noneActive");
    } else if (!mentionedArchived && defaultArchived) {
      unavailableMessage = serverLine(language, "server.rooms.archived", { bot: defaultArchived.name });
    }
    if (unavailableMessage) {
      store.appendMessage(threadId, {
        role: "bot",
        kind: "activity",
        tool: { name: unavailableMessage, ok: false },
      });
    }
}
