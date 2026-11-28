import { createAiTwinStore } from "../ai-twin.ts";
import { twinLearningText, twinLearningView } from "../ai-twin-learning.ts";
import { sinceFreshStart } from "../fresh-start.ts";
import { redactSecretsInText } from "../redact.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createAiTwinRoutes } from "../routes/ai-twin.ts";
import type { ChannelRouteDeps } from "../routes/channels.ts";
import type { BotRecord, GroupRecord, Store, TaskRecord } from "../store.ts";

type Visibility = { bot(id: string): boolean; thread(id: string): boolean; group(id: string): boolean };
type TwinRoutes = Parameters<typeof createAiTwinRoutes>[0];

export function createAiTwinHost(deps: {
  enabled: boolean;
  desktop: boolean;
  dataDir: string;
  workspace: string;
  store: Store;
  preview: TwinRoutes["preview"];
  blocked: () => boolean;
  liveSession: (auth: RequestAuth) => boolean;
  visible: (auth: RequestAuth) => Visibility;
  mayLearn: () => boolean;
  ownerThread: (threadId: string) => boolean;
  ownerLine: (person?: string) => boolean;
  roomReady: (room: GroupRecord) => boolean;
  roomSendRefused: (auth: RequestAuth, threadId: string) => string | null;
  sender: ChannelRouteDeps["messageSender"];
}) {
  const { store, desktop } = deps;
  const privateStore = createAiTwinStore(deps.dataDir, deps.workspace);
  const desktopOwner = (auth: RequestAuth) => auth.kind === "loopback" && auth.desktopOwner === true && !auth.companionDevice;
  const signedIn = (auth: RequestAuth) => auth.kind === "session" && auth.via !== "ticket" && deps.liveSession(auth);
  const owner = (auth: RequestAuth) => deps.enabled && (desktop ? desktopOwner(auth) : signedIn(auth) && auth.scopes.includes("admin"));
  const phone = (auth: RequestAuth) => deps.enabled && desktop && auth.kind === "loopback" && Boolean(auth.companionDevice);

  function eligible(visible: Visibility, bot: BotRecord, task: TaskRecord): boolean {
    return visible.bot(bot.id) && visible.thread(task.threadId) && !task.archivedAt && !task.routineRunId && !task.openedBy;
  }

  function learnedRows(auth: RequestAuth, sources: readonly string[]) {
    if (!sources.length || !deps.mayLearn()) return [];
    const visible = deps.visible(auth);
    return sources.flatMap((thread) => {
      const bot = store.botByThread(thread);
      const task = bot && store.taskByThread(bot.id, thread);
      if (!bot || !task || !eligible(visible, bot, task) || !deps.ownerThread(thread)) return [];
      return sinceFreshStart(store.activePath(thread)).slice(-180).flatMap((line) => {
        if (!deps.ownerLine(line.sender?.id)) return [];
        const text = twinLearningText(line);
        return text ? [{ thread, message: line.id, text, ts: line.at }] : [];
      });
    });
  }

  function learning(auth: RequestAuth, sources: readonly string[]) {
    const visible = deps.visible(auth);
    const conversations = deps.mayLearn() ? store.bots.flatMap((bot) => store.tasks(bot.id)
      .filter((task) => eligible(visible, bot, task))
      .map((task) => ({ id: task.threadId, label: [bot.name, task.title].filter(Boolean).join(" · ") }))) : [];
    const rooms = store.groups.filter((group) => visible.group(group.id) && deps.roomReady(group))
      .map((group) => ({ id: group.id, label: group.name }));
    return twinLearningView(conversations, rooms, learnedRows(auth, sources));
  }

  const reply: NonNullable<ChannelRouteDeps["twinReply"]> = ({ auth, group, threadId, text, replyTo, sendId }) => {
    const question = /^@AI Twin(?:[,:：]\s*|\s+)(\S[\s\S]*)$/i.exec(text)?.[1];
    if (!question || !deps.enabled || deps.blocked() || !deps.roomReady(group) ||
        (!desktopOwner(auth) && !phone(auth) && !signedIn(auth)) ||
        !deps.visible(auth).thread(threadId) || deps.roomSendRefused(auth, threadId)) return;
    let lesson;
    try { lesson = privateStore.roomReply(group.id, question); }
    catch { return; }
    if (!lesson) return;
    const at = Date.now();
    const messages = store.appendLinkedMessages(threadId, [
      { sourceId: "request", message: {
        at, role: "user", kind: "text", text, channelMode: "chat", replyToId: replyTo?.id,
        sendId, sender: deps.sender(auth),
      } },
      { sourceId: "reply", replySourceId: "request", message: {
        at, role: "bot", kind: "text", text: redactSecretsInText(lesson.answer),
        from: { botId: "ai-twin", name: "AI Twin", color: "#64748b" },
      } },
    ]);
    return messages.get("request")!;
  };

  return {
    reply,
    routes: createAiTwinRoutes({
      store: privateStore, preview: deps.preview, owner, phone, canEnablePhone: desktop, learning,
      learnedStyle: (auth, sources) => twinLearningView([], [], learnedRows(auth, sources)).style,
      blocked: deps.blocked,
    }),
  };
}
