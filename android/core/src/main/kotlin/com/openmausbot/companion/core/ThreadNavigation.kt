// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.core

data class BotThreadGroup(val project: BotProject?, val tasks: List<BotTask>) {
    val id: String get() = project?.let { "project:${it.id}" } ?: "unfiled"
}

val BotTask.displayTitle: String
    get() = title.trim().ifEmpty { "Untitled thread" }

val BotTask.isWorking: Boolean
    get() = activity == "working" || activity == "running" || busy == true

val BotTask.isWaitingOnTeammate: Boolean
    get() = waitingOnTeammate == true

fun BotTask.demandsAttention(queued: Boolean = false): Boolean =
    isWaitingOnTeammate || isWorking || busy == true || unread == true || queued ||
        activity in setOf("waiting-on-you", "waiting", "queued")

fun nextSnoozeExpiry(tasks: List<BotTask>, now: Long = System.currentTimeMillis()): Long? =
    tasks.asSequence()
        .mapNotNull { it.snoozedUntil }
        .filter { it > 0 && it > now }
        .minOrNull()
        ?.toLong()

fun attentionRank(task: BotTask, activeThreadId: String, queued: Boolean = false): Int = when {
    task.activity == "waiting-on-you" -> 0
    task.busy == true || task.activity == "working" -> 1
    task.activity == "queued" || queued -> 2
    task.unread == true -> 3
    task.threadId == activeThreadId -> 4
    else -> 5
}

fun listedThreads(tasks: List<BotTask>): List<BotTask> =
    tasks.withIndex().sortedWith(
        compareByDescending<IndexedValue<BotTask>> { it.value.pinned == true }
            .thenByDescending { it.value.listStamp }
            .thenBy { it.index },
    ).map { it.value }

fun orderedThreads(
    tasks: List<BotTask>,
    activeThreadId: String,
    queuedThreadIds: Set<String> = emptySet(),
): List<BotTask> =
    tasks.sortedBy { attentionRank(it, activeThreadId, queued = it.threadId in queuedThreadIds) }

val Bot.visibleTasks: List<BotTask>
    get() = tasks.orEmpty().filter { it.routineRunId == null }

fun Bot.threadGroups(
    matching: String = "",
    includingClosed: Boolean = false,
    now: Long = System.currentTimeMillis(),
    queuedThreadIds: Set<String> = emptySet(),
): List<BotThreadGroup> {
    val search = matching.trim()
    val threads = when {
        tasks == null -> listOf(BotTask(
            threadId = threadId, title = "", createdAt = createdAt,
            modelSelection = modelSelection, busy = busy, activity = activity, unread = unread,
            waitingOnTeammate = waitingOnTeammate,
            approvalMode = approvalMode, autoApprove = autoApprove, alwaysAllow = alwaysAllow,
        ))
        includingClosed || search.isNotEmpty() -> visibleTasks
        else -> visibleTasks.filter {
            it.pinned == true ||
                (!it.isClosed && !it.isArchived && !it.isSnoozed(now)) ||
                it.demandsAttention(queued = queuedThreadIds.contains(it.threadId)) ||
                it.threadId == threadId
        }
    }
    val ordered = listedThreads(threads)
    val projectIds = mutableSetOf<String>()
    val groups = buildList {
        projects.orEmpty().forEach { project ->
            if (projectIds.add(project.id)) {
                val filed = ordered.filter { it.projectId == project.id }
                if (filed.isNotEmpty()) add(BotThreadGroup(project, filed))
            }
        }
        val unfiled = ordered.filter { it.projectId !in projectIds }
        if (unfiled.isNotEmpty()) add(BotThreadGroup(null, unfiled))
    }
    if (search.isEmpty()) return groups
    return groups.mapNotNull { group ->
        if (group.project?.name?.contains(search, ignoreCase = true) == true) group
        else group.tasks.filter { it.displayTitle.contains(search, ignoreCase = true) }
            .takeIf { it.isNotEmpty() }?.let { BotThreadGroup(group.project, it) }
    }
}

fun Room.forTask(selectedThreadId: String): Room? {
    val task = tasks?.firstOrNull { it.threadId == selectedThreadId }
    if (task == null && selectedThreadId != threadId) return null
    return copy(
        threadId = selectedThreadId,
        unread = task?.unread ?: (tasks == null && selectedThreadId == threadId && unread),
        busyBotId = busyBotId.takeIf { selectedThreadId == threadId },
        messages = messages.takeIf { selectedThreadId == threadId },
        hasMore = hasMore.takeIf { selectedThreadId == threadId },
    )
}
