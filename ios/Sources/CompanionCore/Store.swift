// Modified for StartupBot; original copyright and license retained.
import Foundation

public struct SidebarSection: Identifiable, Hashable, Sendable {
    public var name: String
    public var chiefs: [Bot]
    public var bots: [Bot]
    public var channels: [Room]

    public var id: String { name }
}

public struct QueuedSend: Decodable, Identifiable, Hashable, Sendable {
    public var queueId: String
    public var text: String

    public var id: String { queueId }

    public init(queueId: String, text: String) {
        self.queueId = queueId
        self.text = text
    }
}

public struct CompanionState: Sendable {
    public var bots: [Bot] = []
    public var rooms: [Room] = []
    public var messages: [String: [Message]] = [:]
    /// Whether there is more transcript above a fetched page, per thread.
    /// An absent entry means no page has loaded; SSE tails do not set this.
    public var hasMore: [String: Bool] = [:]
    public var activeLeafIds: [String: String] = [:]
    public var cursor: String?
    public var notifications: [NotificationFrame] = []
    public var streaming: [String: String] = [:]
    public var reasoning: [String: String] = [:]
    public var screens: [String: ScreenFrame] = [:]
    public var pendingQueued: [String: [QueuedSend]] = [:]
    public private(set) var botQueueRevision = 0
    private(set) var drainedQueueIds: [String] = []

    public init() {}

    public func transcript(forThread threadId: String) -> [Message] {
        messages[threadId] ?? []
    }

    public func hasLoadedPage(forThread threadId: String) -> Bool {
        hasMore[threadId] != nil
    }

    public func visibleTranscript(forThread threadId: String) -> [Message] {
        let all = transcript(forThread: threadId)
        guard let leafId = activeLeafIds[threadId] ?? bot(forThread: threadId)?.activeLeafId else { return all }
        let byId = Dictionary(all.map { ($0.id, $0) }, uniquingKeysWith: { _, newest in newest })
        guard var current = byId[leafId] else { return all }
        var visible: [Message] = []
        var visited = Set<String>()
        while visited.insert(current.id).inserted {
            visible.append(current)
            guard let parentId = current.parentId, let parent = byId[parentId] else { break }
            current = parent
        }
        return visible.reversed()
    }

    public func bot(_ id: String) -> Bot? {
        bots.first { $0.id == id }
    }

    public func bot(forThread threadId: String) -> Bot? {
        guard let owner = bots.first(where: { $0.threadId == threadId || $0.tasks?.contains(where: { $0.threadId == threadId }) == true }),
              var view = owner.projected(forThread: threadId) else { return nil }
        view.activeLeafId = activeLeafIds[threadId] ?? view.activeLeafId
        return view
    }

    public func room(forThread threadId: String) -> Room? {
        rooms.lazy.compactMap { $0.projected(forThread: threadId) }.first
    }

    public var sidebarSections: [SidebarSection] {
        let visibleBots = bots.filter { $0.hidden != true }
        let visibleChannels = rooms.filter { $0.dm != true }
        let sectionChiefs = visibleBots.filter {
            $0.chiefOfStaff == true && Self.sectionName($0.section) != nil
        }
        let sectionBots = visibleBots.filter {
            $0.chiefOfStaff != true && !Self.isSidebarPinned($0) && Self.sectionName($0.section) != nil
        }
        var names: [String] = []
        for raw in sectionBots.map(\.section) + sectionChiefs.map(\.section) + visibleChannels.map(\.section) {
            guard let name = Self.sectionName(raw), !names.contains(name) else { continue }
            names.append(name)
        }
        return names.map { name in
            SidebarSection(
                name: name,
                chiefs: sectionChiefs.filter { Self.sectionName($0.section) == name },
                bots: sectionBots.filter { Self.sectionName($0.section) == name },
                channels: visibleChannels.filter { Self.sectionName($0.section) == name }
            )
        }
    }

    public var unsectionedChief: Bot? {
        bots.first {
            $0.hidden != true
                && $0.chiefOfStaff == true
                && Self.sectionName($0.section) == nil
        }
    }

    public var unsectionedBots: [Bot] {
        bots.filter {
            $0.hidden != true
                && $0.chiefOfStaff != true
                && !Self.isSidebarPinned($0)
                && Self.sectionName($0.section) == nil
        }
    }

    public var pinnedBots: [Bot] {
        bots.filter { $0.hidden != true && Self.isSidebarPinned($0) }
    }

    public var unsectionedChannels: [Room] {
        rooms.filter { $0.dm != true && Self.sectionName($0.section) == nil }
    }

    public var botChats: [Room] {
        rooms.filter { $0.dm == true }
    }

    private static func sectionName(_ raw: String?) -> String? {
        guard let name = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else {
            return nil
        }
        return name
    }

    private static func isSidebarPinned(_ bot: Bot) -> Bool {
        bot.pinned == true && bot.chiefOfStaff != true
    }

    public var pendingApprovals: [(threadId: String, message: Message)] {
        var out: [(threadId: String, message: Message)] = []
        let botThreads = bots.flatMap { [$0.threadId] + ($0.tasks ?? []).map(\.threadId) }
        let roomThreads = rooms.flatMap { [$0.threadId] + ($0.tasks ?? []).map(\.threadId) }
        let activeThreads = Set(botThreads + roomThreads)
        for threadId in activeThreads {
            for message in visibleTranscript(forThread: threadId) where message.card?.isPending == true {
                out.append((threadId: threadId, message: message))
            }
        }
        return out.sorted { $0.message.at > $1.message.at }
    }

    public var unreadCount: Int {
        let botCount = bots.filter { $0.hidden != true }.reduce(0) { count, bot in
            if bot.tasks?.contains(where: { $0.unread != nil }) == true {
                return count + bot.visibleTasks.filter { $0.unread == true }.count
            }
            let hasConversation = bot.tasks == nil || !bot.visibleTasks.isEmpty
            return count + (hasConversation && bot.unread ? 1 : 0)
        }
        return botCount + rooms.filter(\.unread).count
    }

    // MARK: - Hydrating

    /// An HTTP snapshot may arrive after the live stream has already folded
    /// newer messages. Reject it atomically rather than erase those events
    /// while keeping a cursor that says they were applied.
    public mutating func hydrate(
        _ fleet: Fleet,
        waitingThreads: [String: ThreadPage] = [:],
        ifCursorMatches expectedCursor: String?
    ) -> Bool {
        guard cursor == expectedCursor else { return false }
        hydrate(fleet, waitingThreads: waitingThreads)
        return true
    }

    public mutating func hydrate(_ fleet: Fleet, waitingThreads: [String: ThreadPage] = [:]) {
        bots = fleet.bots
        rooms = fleet.groups
        messages.removeAll()
        hasMore.removeAll()
        activeLeafIds.removeAll()
        for bot in fleet.bots {
            messages[bot.threadId] = bot.messages ?? []
            if bot.messages != nil { hasMore[bot.threadId] = bot.hasMore ?? false }
            activeLeafIds[bot.threadId] = bot.activeLeafId
        }
        for room in fleet.groups {
            messages[room.threadId] = room.messages ?? []
            if room.messages != nil { hasMore[room.threadId] = room.hasMore ?? false }
        }
        for (threadId, page) in waitingThreads where bot(forThread: threadId) != nil || room(forThread: threadId) != nil {
            merge(page, intoThread: threadId)
        }
        if let queues = fleet.botQueuedMessages { replaceBotQueues(queues) }
        for threadId in Array(pendingQueued.keys) { reconcileQueued(inThread: threadId) }
    }

    public mutating func prepend(_ page: ThreadPage, toThread threadId: String) {
        let existing = messages[threadId] ?? []
        let known = Set(existing.map(\.id))
        messages[threadId] = page.messages.filter { !known.contains($0.id) } + existing
        hasMore[threadId] = page.hasMore ?? false
    }

    public mutating func merge(_ page: ThreadPage, intoThread threadId: String) {
        var byId = Dictionary(
            uniqueKeysWithValues: (messages[threadId] ?? []).map { ($0.id, $0) }
        )
        for message in page.messages { byId[message.id] = message }
        messages[threadId] = byId.values.sorted {
            $0.at == $1.at ? $0.id < $1.id : $0.at < $1.at
        }
        hasMore[threadId] = page.hasMore ?? hasMore[threadId] ?? false
        if let leaf = page.activeLeafId { activeLeafIds[threadId] = leaf }
        reconcileQueued(inThread: threadId)
    }

    public func versions(of message: Message, inThread threadId: String) -> [Message] {
        guard message.role == .user, message.kind == .text else { return [] }
        return transcript(forThread: threadId)
            .filter { $0.role == .user && $0.kind == .text && $0.parentId == message.parentId }
            .sorted { $0.at == $1.at ? $0.id < $1.id : $0.at < $1.at }
    }


    public mutating func apply(_ streamFrame: StreamFrame) {
        apply(streamFrame.frame)
    }

    public mutating func apply(_ frame: Frame) {
        switch frame {
        case .hello:
            break

        case let .message(threadId, message):
            append(message, to: threadId)
            if let bot = bot(forThread: threadId), message.parentId == bot.activeLeafId {
                activeLeafIds[threadId] = message.id
                if let index = bots.firstIndex(where: { $0.threadId == threadId }) {
                    bots[index].activeLeafId = message.id
                }
            }
            if message.role == .bot, message.kind == .text {
                clearStream(threadId)
            }

        case let .messagePatch(threadId, message):
            var thread = messages[threadId] ?? []
            if let index = thread.firstIndex(where: { $0.id == message.id }) {
                thread[index] = message
                messages[threadId] = thread
            } else {
                append(message, to: threadId)
            }

        case let .thread(threadId, activeLeafId):
            activeLeafIds[threadId] = activeLeafId
            if let index = bots.firstIndex(where: { $0.threadId == threadId }) {
                bots[index].activeLeafId = activeLeafId
            }
            clearStream(threadId)

        case let .bot(bot):
            if let leaf = bot.activeLeafId { activeLeafIds[bot.threadId] = leaf }
            if let index = bots.firstIndex(where: { $0.id == bot.id }) {
                var merged = bot
                if let replacement = bot.messages {
                    messages[bot.threadId] = replacement
                    hasMore[bot.threadId] = bot.hasMore ?? false
                    merged.messages = replacement
                    if bot.currentTaskBusy != true { clearStream(bot.threadId) }
                    reconcileQueued(inThread: bot.threadId)
                } else {
                    merged.messages = messages[bot.threadId]
                    merged.activeLeafId = activeLeafIds[bot.threadId]
                }
                bots[index] = merged
                if bot.currentTaskBusy != true { clearStream(bot.threadId) }
            } else {
                bots.append(bot)
                if let page = bot.messages {
                    merge(ThreadPage(messages: page, hasMore: bot.hasMore ?? false), intoThread: bot.threadId)
                } else if messages[bot.threadId] == nil {
                    messages[bot.threadId] = []
                }
            }

        case let .botQueued(queues):
            replaceBotQueues(queues)

        case let .botDeleted(botId):
            if let index = bots.firstIndex(where: { $0.id == botId }) {
                let threadIds = Set([bots[index].threadId] + (bots[index].tasks ?? []).map(\.threadId))
                for threadId in threadIds {
                    messages.removeValue(forKey: threadId)
                    hasMore.removeValue(forKey: threadId)
                    activeLeafIds.removeValue(forKey: threadId)
                    clearStream(threadId)
                }
                clearScreen(botId)
                bots.remove(at: index)
            }

        case let .room(room):
            if let index = rooms.firstIndex(where: { $0.id == room.id }) {
                var merged = room
                let previous = rooms[index]
                if let replacement = room.messages {
                    messages[room.threadId] = replacement
                    hasMore[room.threadId] = room.hasMore ?? false
                    merged.messages = replacement
                    clearStream(previous.threadId)
                    if previous.threadId != room.threadId { clearStream(room.threadId) }
                } else {
                    merged.messages = previous.messages
                }
                rooms[index] = merged
            } else {
                rooms.append(room)
                if let page = room.messages {
                    merge(ThreadPage(messages: page, hasMore: room.hasMore ?? false), intoThread: room.threadId)
                } else if messages[room.threadId] == nil {
                    messages[room.threadId] = []
                }
            }

        case let .roomDeleted(groupId):
            if let index = rooms.firstIndex(where: { $0.id == groupId }) {
                let threadId = rooms[index].threadId
                messages.removeValue(forKey: threadId)
                hasMore.removeValue(forKey: threadId)
                clearStream(threadId)
                rooms.remove(at: index)
            }

        case let .notify(notification):
            notifications.append(notification)
            if notifications.count > 100 {
                notifications.removeFirst(notifications.count - 100)
            }

        case let .runtime(event):
            apply(runtime: event)

        case let .screen(botId, png, mime):
            screens[botId] = ScreenFrame(png: png, mime: mime)

        case .computer, .config, .unknown:
            break
        }
    }

    private mutating func apply(runtime event: RuntimeEvent) {
        switch event.type {
        case "content.delta":
            guard let delta = event.delta, !delta.isEmpty else { return }
            switch event.streamKind {
            case "assistant_text":
                streaming[event.threadId, default: ""] += delta
            case "reasoning_text":
                reasoning[event.threadId, default: ""] += delta
            default:
                break
            }
        case "turn.completed", "turn.failed", "turn.aborted":
            clearStream(event.threadId)
        default:
            break
        }
    }

    public mutating func clearScreen(_ botId: String) {
        screens.removeValue(forKey: botId)
    }

    public mutating func clearStream(_ threadId: String) {
        streaming.removeValue(forKey: threadId)
        reasoning.removeValue(forKey: threadId)
    }

    private mutating func append(_ message: Message, to threadId: String) {
        var thread = messages[threadId] ?? []
        if let index = thread.firstIndex(where: { $0.id == message.id }) {
            thread[index] = message
        } else {
            thread.append(message)
        }
        messages[threadId] = thread
        if let queueId = message.queueId { retireQueued(queueId, inThread: threadId) }
    }

    private static let maxDrainedQueueIds = 64

    public mutating func rememberQueued(_ send: QueuedSend, inThread threadId: String, ifBotQueueRevisionMatches expectedRevision: Int? = nil) {
        if let expectedRevision, expectedRevision != botQueueRevision {
            return
        }
        if let index = drainedQueueIds.firstIndex(of: send.queueId) {
            drainedQueueIds.remove(at: index)
            return
        }
        var waiting = pendingQueued[threadId] ?? []
        guard !waiting.contains(where: { $0.queueId == send.queueId }) else { return }
        waiting.append(send)
        pendingQueued[threadId] = waiting
    }

    public mutating func replaceBotQueues(_ queues: [String: [QueuedSend]]) {
        botQueueRevision &+= 1
        let roomThreads = Set(rooms.flatMap { [$0.threadId] + ($0.tasks ?? []).map(\.threadId) })
        let liveIDs = Set(queues.values.flatMap { $0.map(\.queueId) })
        var next = queues.filter { !$0.value.isEmpty }
        for (threadId, entries) in pendingQueued {
            if roomThreads.contains(threadId) {
                next[threadId] = entries
            } else {
                drainedQueueIds.append(contentsOf: entries.filter { !liveIDs.contains($0.queueId) }.map(\.queueId))
            }
        }
        drainedQueueIds = Array(drainedQueueIds.suffix(Self.maxDrainedQueueIds))
        pendingQueued = next
    }

    private mutating func retireQueued(_ queueId: String, inThread threadId: String) {
        forgetQueued(queueId, inThread: threadId)
        drainedQueueIds.append(queueId)
        if drainedQueueIds.count > Self.maxDrainedQueueIds {
            drainedQueueIds.removeFirst(drainedQueueIds.count - Self.maxDrainedQueueIds)
        }
    }

    public mutating func forgetQueued(_ queueId: String, inThread threadId: String) {
        guard var waiting = pendingQueued[threadId] else { return }
        waiting.removeAll { $0.queueId == queueId }
        if waiting.isEmpty { pendingQueued.removeValue(forKey: threadId) }
        else { pendingQueued[threadId] = waiting }
    }

    private mutating func reconcileQueued(inThread threadId: String) {
        guard pendingQueued[threadId] != nil else { return }
        let landed = Set((messages[threadId] ?? []).compactMap(\.queueId))
        guard !landed.isEmpty else { return }
        for queueId in landed { retireQueued(queueId, inThread: threadId) }
    }
}

extension CompanionState {
    public mutating func resetCursor(_ cursor: String) {
        self.cursor = cursor
    }

    public mutating func advance(to seq: Int?) {
        guard let seq, let cursor, let streamId = cursor.split(separator: ":").first else { return }
        self.cursor = "\(streamId):\(seq)"
    }
}
