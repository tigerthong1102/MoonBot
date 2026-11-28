import { twinSourceIndex, type TwinExampleSource } from "../ai-twin-lesson-sources.ts";
import { randomUUID } from "node:crypto";
import { createAiTwinStore } from "../ai-twin.ts";
import { recentTwinStyle, TWIN_STYLE_SAMPLE_LIMIT, twinLearningText, twinLearningView, type TwinLearningRow } from "../ai-twin-learning.ts";
import { sinceFreshStart } from "../fresh-start.ts";
import { redactSecretsInText } from "../redact.ts";
import type { ChannelQueueItem, QueuedTwinReply } from "../channel-queue.ts";
import type { SessionRecord } from "../sessions.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createAiTwinRoutes } from "../routes/ai-twin.ts";
import type { ChannelRouteDeps } from "../routes/channels.ts";
import type { BotRecord, GroupRecord, Message, Store, TaskRecord } from "../store.ts";

type Visibility = { bot(id: string): boolean; thread(id: string): boolean; group(id: string): boolean };
type TwinRoutes = Parameters<typeof createAiTwinRoutes>[0];

export function createAiTwinHost(deps: {
  enabled: boolean;
  desktop: boolean;
  dataDir: string;
  workspace: string;
  store: Store;
  preview: TwinRoutes["preview"];
  zaloRecipe?: TwinRoutes["zaloRecipe"];
  blocked: () => boolean;
  liveSession: (auth: RequestAuth) => boolean;
  sessionRecord: (id: string) => SessionRecord | null;
  visible: (auth: RequestAuth) => Visibility;
  assertUnattended?: (id: string) => void;
  mayLearn: () => boolean;
  ownerThread: (threadId: string) => boolean;
  ownerLine: (person?: string) => boolean;
  roomReady: (room: GroupRecord) => boolean;
  roomSendRefused: (auth: RequestAuth, threadId: string) => string | null;
  sender: ChannelRouteDeps["messageSender"];
}) {
  const { store, desktop } = deps;
  let watched: Set<string> | undefined;
  const refreshWatched = () => { watched = undefined; };
  const privateStore = createAiTwinStore(deps.dataDir, deps.workspace, undefined, refreshWatched);
  const boot = randomUUID();
  const revokedDevices = new Set<string>();
  const desktopOwner = (auth: RequestAuth) => auth.kind === "loopback" && auth.desktopOwner === true && !auth.companionDevice;
  const signedIn = (auth: RequestAuth) => auth.kind === "session" && auth.via !== "ticket" && deps.liveSession(auth);
  const owner = (auth: RequestAuth) => deps.enabled && (desktop ? desktopOwner(auth) : signedIn(auth) && auth.scopes.includes("admin"));
  const phone = (auth: RequestAuth) => deps.enabled && desktop && auth.kind === "loopback" && Boolean(auth.companionDevice && !revokedDevices.has(auth.companionDevice));

  function eligible(visible: Visibility, bot: BotRecord, task: TaskRecord): boolean {
    return visible.bot(bot.id) && visible.thread(task.threadId) && !task.archivedAt && !task.routineRunId && !task.openedBy;
  }

  function threadRows(thread: string, recent = false) {
    const lines = sinceFreshStart(store.activePath(thread));
    const byId = new Map(lines.map(line => [line.id, line]));
    const rows: TwinLearningRow[] = [];
    for (let index = lines.length - 1; index >= 0; index--) {
      const line = lines[index]!;
      if (!deps.ownerLine(line.sender?.id)) continue;
      const text = twinLearningText(line, line.replyToId ? byId.get(line.replyToId) : undefined);
      if (!text) continue;
      rows.push({ thread, message: line.id, text, ts: line.at, replyToId: line.replyToId });
      if (recent && rows.length === TWIN_STYLE_SAMPLE_LIMIT) break;
    }
    return rows;
  }

  function learnedRows(auth: RequestAuth, sources: readonly string[], recent = false) {
    if (!sources.length || !deps.mayLearn()) return [];
    const visible = deps.visible(auth);
    return sources.flatMap((thread) => {
      const bot = store.botByThread(thread);
      const task = bot && store.taskByThread(bot.id, thread);
      if (!bot || !task || !eligible(visible, bot, task) || !deps.ownerThread(thread)) return [];
      return threadRows(thread, recent);
    });
  }

  function sourceIndex(auth: RequestAuth, threads: readonly string[]) {
    return twinSourceIndex(learnedRows(auth, threads));
  }

  function storeFor(auth: RequestAuth) {
    return createAiTwinStore(deps.dataDir, deps.workspace, (sources) => {
      const index = sourceIndex(auth, [...new Set(sources.map(source => source.thread))]);
      return new Set(sources.filter(source => index(source.thread, source.message)?.digest === source.digest).map(source => source.digest));
    }, refreshWatched);
  }

  if (deps.enabled) store.onChange(change => {
    if (change.type === "thread.deleted") return privateStore.discardConversation(change.threadId);
    if (change.type === "message.patch") {
      watched ??= new Set(privateStore.conversationSources().flatMap(source => [source.message, source.parent]
        .filter(Boolean).map(id => source.thread + ":" + id)));
      if (!watched.has(change.threadId + ":" + change.message.id)) return;
    } else if (change.type !== "thread.reset") return;
    privateStore.discardConversation(change.threadId, () => {
      const index = twinSourceIndex(threadRows(change.threadId));
      return message => index(change.threadId, message)?.digest;
    });
  });

  function learning(auth: RequestAuth, sources: readonly string[]) {
    const visible = deps.visible(auth);
    const conversations = deps.mayLearn() ? store.bots.flatMap((bot) => store.tasks(bot.id)
      .filter((task) => eligible(visible, bot, task))
      .map((task) => ({ id: task.threadId, label: [bot.name, task.title].filter(Boolean).join(" · ") }))) : [];
    const rooms = store.groups.filter((group) => visible.group(group.id) && deps.roomReady(group))
      .map((group) => ({ id: group.id, label: group.name }));
    const rows = learnedRows(auth, sources);
    const view = twinLearningView(conversations, rooms, rows);
    const index = twinSourceIndex(rows);
    return { ...view, examples: view.examples.map(example => ({ ...example, digest: index(example.thread, example.message)?.digest })) };
  }

  function roomAnswer(auth: RequestAuth, group: GroupRecord, threadId: string, text: string) {
    const question = /^@AI Twin(?:[,:：]\s*|\s+)(\S[\s\S]*)$/i.exec(text)?.[1];
    if (!question || !deps.enabled || deps.blocked() || !deps.roomReady(group) ||
        (!desktopOwner(auth) && !phone(auth) && !signedIn(auth)) || deps.roomSendRefused(auth, threadId)) return;
    const visible = deps.visible(auth);
    if (!visible.group(group.id) || !visible.thread(threadId)) return;
    try { return privateStore.roomReply(group.id, question); }
    catch { return; }
  }

  function publish(
    threadId: string,
    request: Pick<Message, "text" | "replyToId" | "sendId" | "sender" | "queueId">,
    answer: string,
  ): Message {
    const at = Date.now();
    const messages = store.appendLinkedMessages(threadId, [
      { sourceId: "request", message: { ...request, at, role: "user", kind: "text", channelMode: "chat" } },
      { sourceId: "reply", replySourceId: "request", message: {
        at, role: "bot", kind: "text", text: redactSecretsInText(answer),
        from: { botId: "ai-twin", name: "AI Twin", color: "#64748b" },
      } },
    ]);
    return messages.get("request")!;
  }

  function queueActor(auth: RequestAuth): QueuedTwinReply["actor"] {
    if (auth.kind === "session") return { kind: "session", id: auth.session.id };
    if (auth.companionDevice) return { kind: "companion", device: auth.companionDevice, boot };
    return { kind: "desktop" };
  }

  function liveActor(actor: QueuedTwinReply["actor"]): RequestAuth | null {
    if (actor.kind === "session") {
      const session = deps.sessionRecord(actor.id);
      return session && { kind: "session", session, via: "bearer", scopes: session.scopes };
    }
    if (!desktop) return null;
    if (actor.kind === "desktop") return { kind: "loopback", scopes: ["admin", "client"], desktopOwner: true };
    // The sidecar verifies pairing at admission. After a reboot the prior device authorization can no longer be proven.
    if (actor.boot !== boot || revokedDevices.has(actor.device)) return null;
    return { kind: "loopback", scopes: ["admin", "client"], companionDevice: actor.device };
  }

  const reply: NonNullable<ChannelRouteDeps["twinReply"]> = ({ auth, group, threadId, text, replyTo, sendId }, working) => {
    const match = roomAnswer(auth, group, threadId, text);
    if (!match) return;
    if (working) return { pending: { twinId: match.twinId, revision: match.revision, actor: queueActor(auth) } };
    return { message: publish(threadId, { text, replyToId: replyTo?.id, sendId, sender: deps.sender(auth) }, match.answer) };
  };

  return {
    reply,
    drain(group: GroupRecord, threadId: string, item: ChannelQueueItem) {
      const pending = item.twinReply;
      if (!pending) return "cancelled" as const;
      const auth = liveActor(pending.actor);
      const match = auth && roomAnswer(auth, group, threadId, item.text);
      if (!match || match.twinId !== pending.twinId || match.revision !== pending.revision) return "cancelled" as const;
      publish(threadId, {
        text: item.text, replyToId: item.replyToId, sendId: item.sendId, sender: item.sender, queueId: item.id,
      }, match.answer);
    },
    revokeDevice(device: string) { revokedDevices.add(device); },
    routes: createAiTwinRoutes({
      store: privateStore, storeFor, assertUnattended: deps.assertUnattended,
      source: (auth, thread, message): TwinExampleSource | undefined => sourceIndex(auth, [thread])(thread, message),
      preview: deps.preview, zaloRecipe: deps.zaloRecipe, owner, phone, canEnablePhone: desktop, desktop, learning,
      learnedStyle: (auth, sources) => recentTwinStyle(learnedRows(auth, sources, true)),
      blocked: deps.blocked,
    }),
  };
}
