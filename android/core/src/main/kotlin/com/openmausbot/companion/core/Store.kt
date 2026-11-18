// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.core

data class PendingApproval(val threadId: String, val message: Message)

data class SidebarSection(
    val name: String,
    val chiefs: List<Bot>,
    val bots: List<Bot>,
    val channels: List<Room>,
) {
    val id: String get() = name
}

data class PendingEdit(
    val sourceId: String,
    val text: String,
    val at: Double = System.currentTimeMillis().toDouble(),
    val baseLeafId: String? = null,
    val requestId: String = java.util.UUID.randomUUID().toString(),
) {
    val placeholderId: String get() = "pending-edit-$sourceId"
}

data class CompanionState(
    val bots: List<Bot> = emptyList(),
    val rooms: List<Room> = emptyList(),
    val messages: Map<String, List<Message>> = emptyMap(),
    val hasMore: Map<String, Boolean> = emptyMap(),
    val cursor: String? = null,
    val notifications: List<NotificationFrame> = emptyList(),
    val streaming: Map<String, String> = emptyMap(),
    val reasoning: Map<String, String> = emptyMap(),
    val activeLeafIds: Map<String, String?> = emptyMap(),
    val screens: Map<String, ScreenFrame> = emptyMap(),
    val pendingQueued: Map<String, List<QueuedSend>> = emptyMap(),
    val drainedQueueIds: List<String> = emptyList(),
    val botQueueRevision: Long = 0,
    val pendingEdits: Map<String, PendingEdit> = emptyMap(),
) {
    val queuedThreadIds: Set<String>
        get() = pendingQueued.keys

    fun transcript(threadId: String): List<Message> = messages[threadId].orEmpty()

    /** An SSE tail is partial history; only a fetched page establishes its boundary. */
    fun hasLoadedPage(threadId: String): Boolean = hasMore.containsKey(threadId)

    fun visibleTranscript(threadId: String): List<Message> {
        val branch = activeBranch(threadId)
        val pending = pendingEdits[threadId] ?: return branch
        val index = branch.indexOfFirst { it.id == pending.sourceId }
        if (index < 0) return branch
        val standIn = Message(
            id = pending.placeholderId,
            role = Message.Role.USER,
            kind = Message.Kind.TEXT,
            at = pending.at,
            text = pending.text,
            parentId = branch[index].parentId,
        )
        return branch.subList(0, index) + standIn
    }

    fun adoptEdit(message: Message, threadId: String, expectedPending: PendingEdit? = null): CompanionState {
        val currentLeaf = botForThread(threadId)?.activeLeafId
        val appended = copy(messages = append(messages, threadId, message))
        if (expectedPending != null && (pendingEdits[threadId] != expectedPending || currentLeaf != expectedPending.baseLeafId)) return appended
        if (appended.activeBranch(threadId).any { it.id == message.id }) return appended
        return appended.copy(
            activeLeafIds = appended.activeLeafIds + (threadId to message.id),
            bots = appended.bots.map { if (it.threadId == threadId) it.copy(activeLeafId = message.id) else it },
        )
    }

    private fun activeBranch(threadId: String): List<Message> {
        val all = transcript(threadId)
        val leafId = if (activeLeafIds.containsKey(threadId)) activeLeafIds[threadId]
            else botForThread(threadId)?.activeLeafId
        if (leafId == null) return all
        val byId = all.associateBy(Message::id)
        var current = byId[leafId] ?: return all
        val visible = mutableListOf<Message>()
        val visited = mutableSetOf<String>()
        while (visited.add(current.id)) {
            visible += current
            val parentId = current.parentId ?: break
            current = byId[parentId] ?: break
        }
        return visible.asReversed()
    }

    fun bot(id: String): Bot? = bots.firstOrNull { it.id == id }
    fun botForThread(threadId: String): Bot? =
        (bots.firstOrNull { it.threadId == threadId }
            ?: bots.firstOrNull { bot -> bot.tasks.orEmpty().any { it.threadId == threadId } })
            ?.forTask(threadId)?.let { view ->
                if (activeLeafIds.containsKey(threadId)) view.copy(activeLeafId = activeLeafIds[threadId]) else view
            }
    fun roomForThread(threadId: String): Room? = rooms.firstOrNull { it.threadId == threadId }
    fun roomOwningTask(threadId: String): Room? = rooms.firstOrNull {
        it.threadId == threadId || it.tasks.orEmpty().any { task -> task.threadId == threadId }
    }

    val sidebarSections: List<SidebarSection>
        get() {
            val visibleBots = bots.filter { it.hidden != true }
            val visibleChannels = rooms.filter { it.dm != true }
            val sectionChiefs = visibleBots.filter {
                it.chiefOfStaff == true && sectionName(it.section) != null
            }
            val sectionBots = visibleBots.filter {
                it.chiefOfStaff != true && !isSidebarPinned(it) && sectionName(it.section) != null
            }
            val names = buildList {
                (sectionBots.map(Bot::section) + sectionChiefs.map(Bot::section) +
                    visibleChannels.map(Room::section)).forEach { raw ->
                    sectionName(raw)?.takeIf { it !in this }?.let(::add)
                }
            }
            return names.map { name ->
                SidebarSection(
                    name = name,
                    chiefs = sectionChiefs.filter { sectionName(it.section) == name },
                    bots = sectionBots.filter { sectionName(it.section) == name },
                    channels = visibleChannels.filter { sectionName(it.section) == name },
                )
            }
        }

    val unsectionedChief: Bot?
        get() = bots.firstOrNull {
            it.hidden != true && it.chiefOfStaff == true && sectionName(it.section) == null
        }

    val unsectionedBots: List<Bot>
        get() = bots.filter {
            it.hidden != true && it.chiefOfStaff != true && !isSidebarPinned(it) &&
                sectionName(it.section) == null
        }

    val pinnedBots: List<Bot>
        get() = bots.filter { it.hidden != true && isSidebarPinned(it) }

    val unsectionedChannels: List<Room>
        get() = rooms.filter { it.dm != true && sectionName(it.section) == null }

    val botChats: List<Room>
        get() = rooms.filter { it.dm == true }

    val pendingApprovals: List<PendingApproval>
        get() = (bots.flatMap { bot -> listOf(bot.threadId) + bot.tasks.orEmpty().map(BotTask::threadId) } +
            rooms.flatMap { room -> listOf(room.threadId) + room.tasks.orEmpty().map(BotTask::threadId) }).distinct()
            .flatMap { threadId ->
                visibleTranscript(threadId)
                    .filter { it.card?.isPending == true }
                    .map { PendingApproval(threadId, it) }
            }
            .sortedByDescending { it.message.at }

    val unreadCount: Int
        get() = bots.filter { it.hidden != true }.sumOf { bot ->
            if (bot.tasks.orEmpty().any { it.unread != null }) bot.visibleTasks.count { it.unread == true }
            else if ((bot.tasks == null || bot.visibleTasks.isNotEmpty()) && bot.unread) 1 else 0
        } + rooms.count(Room::unread)

    fun hydrate(fleet: Fleet, waitingThreads: Map<String, ThreadPage> = emptyMap()): CompanionState {
        val hydratedMessages = buildMap {
            fleet.bots.forEach { put(it.threadId, it.messages.orEmpty()) }
            fleet.groups.forEach { put(it.threadId, it.messages.orEmpty()) }
        }
        val hydratedHasMore = buildMap {
            fleet.bots.filter { it.messages != null }.forEach { put(it.threadId, it.hasMore ?: false) }
            fleet.groups.filter { it.messages != null }.forEach { put(it.threadId, it.hasMore ?: false) }
        }
        return copy(
            bots = fleet.bots,
            rooms = fleet.groups,
            messages = hydratedMessages,
            hasMore = hydratedHasMore,
            activeLeafIds = fleet.bots.associate { it.threadId to it.activeLeafId },
        )
            .let { state ->
                waitingThreads.entries.fold(state) { current, (threadId, page) ->
                    if (current.botForThread(threadId) != null || current.roomOwningTask(threadId) != null)
                        current.merge(page, threadId) else current
                }
            }
            .let { state -> fleet.botQueuedMessages?.let { state.replaceBotQueues(it) } ?: state }
            .reconcileAllQueued()
    }

    fun prepend(page: ThreadPage, threadId: String): CompanionState {
        val existing = messages[threadId].orEmpty()
        val known = existing.mapTo(mutableSetOf(), Message::id)
        return copy(
            messages = messages + (threadId to (page.messages.filterNot { it.id in known } + existing)),
            hasMore = hasMore + (threadId to (page.hasMore ?: false)),
        )
    }

    fun merge(page: ThreadPage, threadId: String): CompanionState {
        val byId = transcript(threadId).associateByTo(linkedMapOf(), Message::id)
        page.messages.forEach { byId[it.id] = it }
        val merged = byId.values.sortedWith(compareBy<Message> { it.at }.thenBy { it.id })
        return copy(
            messages = messages + (threadId to merged),
            hasMore = hasMore + (threadId to (page.hasMore ?: hasMore[threadId] ?: false)),
            activeLeafIds = page.activeLeafId?.let { activeLeafIds + (threadId to it) } ?: activeLeafIds,
        ).reconcileQueued(threadId)
    }

    fun versions(message: Message, threadId: String): List<Message> {
        if (message.role != Message.Role.USER || message.kind != Message.Kind.TEXT) return emptyList()
        return transcript(threadId)
            .filter {
                it.role == Message.Role.USER && it.kind == Message.Kind.TEXT && it.parentId == message.parentId
            }
            .sortedWith(compareBy<Message> { it.at }.thenBy { it.id })
    }

    fun apply(streamFrame: StreamFrame): CompanionState = apply(streamFrame.frame)

    fun apply(frame: Frame): CompanionState = when (frame) {
        is Frame.Hello -> this

        is Frame.Message -> {
            val leaf = if (activeLeafIds.containsKey(frame.threadId)) activeLeafIds[frame.threadId]
                else botForThread(frame.threadId)?.activeLeafId
            var result = copy(
                messages = append(messages, frame.threadId, frame.message),
                activeLeafIds = if (frame.message.parentId == leaf)
                    activeLeafIds + (frame.threadId to frame.message.id) else activeLeafIds,
                bots = bots.map {
                    if (
                        it.threadId == frame.threadId &&
                        frame.message.parentId == it.activeLeafId
                    ) {
                        it.copy(activeLeafId = frame.message.id)
                    } else {
                        it
                    }
                },
            )
            if (frame.message.role == Message.Role.BOT && frame.message.kind == Message.Kind.TEXT) {
                result = result.clearStream(frame.threadId)
            }
            frame.message.queueId?.let { result = result.retireQueued(it, frame.threadId) }
            result.noteThreadActivity(frame.threadId, frame.message.at)
        }

        is Frame.MessagePatch -> {
            val existing = transcript(frame.threadId)
            val index = existing.indexOfFirst { it.id == frame.message.id }
            val patched = if (index >= 0) {
                existing.toMutableList().also { it[index] = frame.message }
            } else {
                append(messages, frame.threadId, frame.message).getValue(frame.threadId)
            }
            copy(messages = messages + (frame.threadId to patched))
                .let { next -> if (index >= 0) next else next.noteThreadActivity(frame.threadId, frame.message.at) }
        }

        is Frame.Thread -> copy(
            activeLeafIds = activeLeafIds + (frame.threadId to frame.activeLeafId),
            bots = bots.map {
                if (it.threadId == frame.threadId) it.copy(activeLeafId = frame.activeLeafId) else it
            },
        ).clearStream(frame.threadId)

        is Frame.Bot -> applyBot(frame.bot)
        is Frame.BotDeleted -> deleteBot(frame.botId)
        is Frame.BotQueued -> replaceBotQueues(frame.queues)
        is Frame.Room -> applyRoom(frame.room)
        is Frame.RoomDeleted -> deleteRoom(frame.groupId)

        is Frame.Notify -> copy(notifications = (notifications + frame.notification).takeLast(100))
        is Frame.Runtime -> applyRuntime(frame.event)
        is Frame.Screen -> copy(screens = screens + (frame.botId to ScreenFrame(frame.png, frame.mime)))

        is Frame.Computer, Frame.Config, is Frame.Unknown -> this
    }

    fun clearScreen(botId: String): CompanionState = copy(screens = screens - botId)

    fun clearStream(threadId: String): CompanionState = copy(
        streaming = streaming - threadId,
        reasoning = reasoning - threadId,
    )


    fun rememberQueued(send: QueuedSend, threadId: String, ifBotQueueRevisionMatches: Long? = null): CompanionState {
        if (ifBotQueueRevisionMatches != null && ifBotQueueRevisionMatches != botQueueRevision) return this
        if (send.queueId in drainedQueueIds) {
            return copy(drainedQueueIds = drainedQueueIds - send.queueId)
        }
        val waiting = pendingQueued[threadId].orEmpty()
        if (waiting.any { it.queueId == send.queueId }) return this
        return copy(pendingQueued = pendingQueued + (threadId to (waiting + send)))
    }

    fun forgetQueued(queueId: String, threadId: String): CompanionState {
        val waiting = pendingQueued[threadId] ?: return this
        val rest = waiting.filterNot { it.queueId == queueId }
        return copy(
            pendingQueued = if (rest.isEmpty()) {
                pendingQueued - threadId
            } else {
                pendingQueued + (threadId to rest)
            },
        )
    }

    fun replaceBotQueues(queues: Map<String, List<QueuedSend>>): CompanionState {
        val roomThreads = buildSet {
            rooms.forEach { room ->
                add(room.threadId)
                room.tasks.orEmpty().forEach { add(it.threadId) }
            }
        }
        val liveIds = buildSet {
            queues.values.forEach { list -> list.forEach { add(it.queueId) } }
        }
        var tombstones = drainedQueueIds
        val next = buildMap {
            queues.forEach { (threadId, entries) ->
                if (entries.isNotEmpty()) put(threadId, entries)
            }
            pendingQueued.forEach { (threadId, entries) ->
                if (threadId in roomThreads) {
                    put(threadId, entries)
                } else {
                    entries.filter { it.queueId !in liveIds }.forEach { tombstones += it.queueId }
                }
            }
        }
        return copy(
            pendingQueued = next,
            botQueueRevision = botQueueRevision + 1,
            drainedQueueIds = tombstones.takeLast(MAX_DRAINED_QUEUE_IDS),
        )
    }

    private fun markDrained(queueId: String): CompanionState =
        copy(drainedQueueIds = (drainedQueueIds + queueId).takeLast(MAX_DRAINED_QUEUE_IDS))

    private fun retireQueued(queueId: String, threadId: String): CompanionState {
        return forgetQueued(queueId, threadId).markDrained(queueId)
    }

    private fun reconcileQueued(threadId: String): CompanionState {
        if (!pendingQueued.containsKey(threadId)) return this
        val landed = transcript(threadId).mapNotNull(Message::queueId).toSet()
        if (landed.isEmpty()) return this
        return landed.fold(this) { state, queueId -> state.retireQueued(queueId, threadId) }
    }

    private fun reconcileAllQueued(): CompanionState =
        pendingQueued.keys.toList().fold(this) { state, threadId -> state.reconcileQueued(threadId) }

    fun resetCursor(cursor: String): CompanionState = copy(cursor = cursor)

    fun advance(seq: Int?): CompanionState {
        val current = cursor ?: return this
        if (seq == null || ':' !in current) return this
        return copy(cursor = "${current.substringBefore(':')}:$seq")
    }

    private fun noteThreadActivity(threadId: String, at: Double): CompanionState {
        if (!at.isFinite()) return this
        fun List<BotTask>.bump() = map { task ->
            if (task.threadId != threadId) task
            else task.copy(updatedAt = maxOf(task.updatedAt ?: 0.0, at))
        }
        return copy(
            bots = bots.map { bot ->
                val tasks = bot.tasks ?: return@map bot
                if (tasks.none { it.threadId == threadId }) bot else bot.copy(tasks = tasks.bump())
            },
            rooms = rooms.map { room ->
                val tasks = room.tasks ?: return@map room
                if (tasks.none { it.threadId == threadId }) room else room.copy(tasks = tasks.bump())
            },
        )
    }

    private fun List<BotTask>?.mergingStamps(previous: List<BotTask>?): List<BotTask>? {
        val incoming = this ?: return previous
        return incoming.map { task ->
            val local = previous?.firstOrNull { it.threadId == task.threadId }?.updatedAt
            val next = when {
                local != null && task.updatedAt != null -> maxOf(local, task.updatedAt)
                else -> local ?: task.updatedAt
            }
            if (next == task.updatedAt) task else task.copy(updatedAt = next)
        }
    }

    private fun applyBot(bot: Bot): CompanionState {
        val index = bots.indexOfFirst { it.id == bot.id }
        if (index < 0) {
            val nextMessages = if (messages.containsKey(bot.threadId)) {
                messages
            } else {
                messages + (bot.threadId to bot.messages.orEmpty())
            }
            val next = copy(bots = bots + bot, messages = nextMessages,
                activeLeafIds = activeLeafIds + (bot.threadId to bot.activeLeafId))
            return bot.messages?.let {
                next.merge(ThreadPage(it, hasMore = bot.hasMore ?: false), bot.threadId)
            } ?: next
        }

        val previous = bots[index]
        val stamped = bot.copy(tasks = bot.tasks.mergingStamps(previous.tasks))
        if (bot.messages == null) {
            val merged = stamped.copy(
                messages = previous.messages.takeIf { previous.threadId == bot.threadId },
                activeLeafId = bot.activeLeafId ?: previous.activeLeafId.takeIf { previous.threadId == bot.threadId },
            )
            val next = copy(bots = bots.replacing(index, merged),
                activeLeafIds = activeLeafIds + (bot.threadId to (bot.activeLeafId ?: activeLeafIds[bot.threadId] ?: merged.activeLeafId)))
            return next.clearSettledTaskStreams(bot)
        }

        val result = copy(
            bots = bots.replacing(index, stamped.copy(messages = bot.messages)),
            messages = messages + (bot.threadId to bot.messages),
            hasMore = hasMore + (bot.threadId to (bot.hasMore ?: false)),
            activeLeafIds = activeLeafIds + (bot.threadId to bot.activeLeafId),
        ).clearSettledTaskStreams(bot)
        return result.reconcileQueued(bot.threadId)
    }

    private fun clearSettledTaskStreams(bot: Bot): CompanionState {
        val settled = bot.tasks.orEmpty().filter { it.busy == false }.map(BotTask::threadId)
        val legacy = if (bot.tasks.orEmpty().none { it.busy != null } && bot.busy != true)
            listOf(bot.threadId) else emptyList()
        return (settled + legacy).fold(this) { state, thread -> state.clearStream(thread) }
    }

    private fun deleteBot(botId: String): CompanionState {
        val bot = bots.firstOrNull { it.id == botId } ?: return this
        val threads = bot.tasks.orEmpty().map(BotTask::threadId) + bot.threadId
        return copy(
            bots = bots.filterNot { it.id == botId },
            messages = messages - threads.toSet(),
            hasMore = hasMore - threads.toSet(),
            activeLeafIds = activeLeafIds - threads.toSet(),
            streaming = streaming - threads.toSet(),
            reasoning = reasoning - threads.toSet(),
            pendingQueued = pendingQueued - threads.toSet(),
            screens = screens - botId,
        )
    }

    private fun applyRoom(room: Room): CompanionState {
        val index = rooms.indexOfFirst { it.id == room.id }
        if (index < 0) {
            val nextMessages = if (messages.containsKey(room.threadId)) {
                messages
            } else {
                messages + (room.threadId to room.messages.orEmpty())
            }
            val next = copy(rooms = rooms + room, messages = nextMessages)
            return room.messages?.let {
                next.merge(ThreadPage(it, hasMore = room.hasMore ?: false), room.threadId)
            } ?: next
        }
        val previous = rooms[index]
        val stamped = room.copy(tasks = room.tasks.mergingStamps(previous.tasks))
        if (room.messages == null) {
            return copy(rooms = rooms.replacing(index, stamped.copy(messages = previous.messages)))
        }
        var result = copy(
            rooms = rooms.replacing(index, stamped.copy(messages = room.messages)),
            messages = messages + (room.threadId to room.messages),
            hasMore = hasMore + (room.threadId to (room.hasMore ?: false)),
        ).clearStream(previous.threadId)
        if (previous.threadId != room.threadId) result = result.clearStream(room.threadId)
        return result
    }

    private fun deleteRoom(groupId: String): CompanionState {
        val room = rooms.firstOrNull { it.id == groupId } ?: return this
        return copy(
            rooms = rooms.filterNot { it.id == groupId },
            messages = messages - room.threadId,
            hasMore = hasMore - room.threadId,
            streaming = streaming - room.threadId,
            reasoning = reasoning - room.threadId,
        )
    }

    private fun applyRuntime(event: RuntimeEvent): CompanionState {
        return when (event.type) {
            "content.delta" -> {
                val delta = event.delta
                if (delta.isNullOrEmpty()) {
                    this
                } else {
                    when (event.streamKind) {
                        "assistant_text" -> copy(
                            streaming = streaming + (event.threadId to (streaming[event.threadId].orEmpty() + delta)),
                        )
                        "reasoning_text" -> copy(
                            reasoning = reasoning + (event.threadId to (reasoning[event.threadId].orEmpty() + delta)),
                        )
                        else -> this
                    }
                }
            }
            "turn.completed", "turn.failed", "turn.aborted" -> clearStream(event.threadId)
            else -> this
        }
    }

    private companion object {
        fun sectionName(raw: String?): String? = raw?.trim()?.takeIf(String::isNotEmpty)

        fun isSidebarPinned(bot: Bot): Boolean = bot.pinned == true && bot.chiefOfStaff != true

        fun append(
            messages: Map<String, List<Message>>,
            threadId: String,
            message: Message,
        ): Map<String, List<Message>> {
            val thread = messages[threadId].orEmpty()
            val index = thread.indexOfFirst { it.id == message.id }
            val next = if (index >= 0) thread.replacing(index, message) else thread + message
            return messages + (threadId to next)
        }

        fun <T> List<T>.replacing(index: Int, value: T): List<T> =
            toMutableList().also { it[index] = value }

        const val MAX_DRAINED_QUEUE_IDS = 64
    }

}
