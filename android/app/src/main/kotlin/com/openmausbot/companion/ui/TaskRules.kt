// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.BotTask
import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.demandsAttention
import com.openmausbot.companion.core.isClosed
import com.openmausbot.companion.core.isArchived
import com.openmausbot.companion.core.displayTitle
import com.openmausbot.companion.core.listedThreads
import com.openmausbot.companion.core.threadGroups

object TaskRules {
    const val UNTITLED = "Untitled thread"

    const val CONTEXT_FOOTER =
        "A thread is one conversation and result. Each routine keeps its results in one thread."

    fun subtitle(bot: Bot): String = bot.title.ifEmpty { "Agent threads" }

    fun subtitle(chat: Chat): String = when (chat) {
        is Chat.BotChat -> subtitle(chat.bot)
        is Chat.RoomChat -> "Group threads"
    }

    fun tasks(bot: Bot, queuedThreadIds: Set<String> = emptySet()): List<BotTask> {
        val navigable = bot.threadGroups(includingClosed = true).flatMap { it.tasks }
        val (pinned, rest) = navigable.partition { it.pinned == true }
        val (surfaced, folded) = rest.partition {
            (!it.isClosed && !it.isArchived) ||
                demandsAttention(it, queued = it.threadId in queuedThreadIds) ||
                isCurrent(it, bot)
        }
        val (closed, archived) = folded.partition { !it.isArchived }
        return listedThreads(pinned) +
            listedThreads(surfaced) +
            listedThreads(closed) +
            listedThreads(archived)
    }

    fun demandsAttention(task: BotTask, queued: Boolean = false): Boolean =
        task.demandsAttention(queued)

    fun isWorking(task: BotTask): Boolean = task.activity == "working" || task.busy == true

    fun tasks(chat: Chat): List<BotTask> = when (chat) {
        is Chat.BotChat -> tasks(chat.bot)
        is Chat.RoomChat -> listedThreads(chat.room.tasks.orEmpty())
    }

    fun title(task: BotTask): String = task.displayTitle

    fun isCurrent(task: BotTask, bot: Bot): Boolean = task.threadId == bot.threadId

    fun isCurrent(task: BotTask, chat: Chat): Boolean = task.threadId == chat.threadId

    private fun independent(bot: Bot): Boolean = bot.tasks.orEmpty().any { it.busy != null }

    fun canCreate(bot: Bot): Boolean = independent(bot) || bot.busy != true

    fun canCreate(chat: Chat): Boolean = when (chat) {
        is Chat.BotChat -> canCreate(chat.bot)
        is Chat.RoomChat -> !chat.busy
    }

    fun canDelete(task: BotTask, bot: Bot): Boolean =
        tasks(bot).size > 1 && tasks(bot).any {
            it.threadId == task.threadId && if (independent(bot)) it.busy != true else bot.busy != true
        }

    fun canDelete(task: BotTask, chat: Chat): Boolean = when (chat) {
        is Chat.BotChat -> canDelete(task, chat.bot)
        is Chat.RoomChat -> tasks(chat).size > 1 && !chat.busy && tasks(chat).any { it.threadId == task.threadId }
    }

    fun canSwitch(task: BotTask, bot: Bot): Boolean = tasks(bot).any { it.threadId == task.threadId } && !isCurrent(task, bot)

    fun canSwitch(task: BotTask, chat: Chat): Boolean = when (chat) {
        is Chat.BotChat -> canSwitch(task, chat.bot)
        is Chat.RoomChat -> canCreate(chat) && !isCurrent(task, chat)
    }

    fun canRename(bot: Bot): Boolean = true

    fun canRename(chat: Chat): Boolean = true

    fun canArchive(task: BotTask, bot: Bot): Boolean =
        task.activity !in setOf("working", "running") &&
            if (independent(bot)) task.busy != true else bot.busy != true

    fun canArchive(task: BotTask, chat: Chat): Boolean = when (chat) {
        is Chat.BotChat -> canArchive(task, chat.bot)
        is Chat.RoomChat -> task.activity !in setOf("working", "running") && task.busy != true
    }
}

object TaskDialogRules {
    fun createEnabled(bot: Bot): Boolean = TaskRules.canCreate(bot)
    fun createEnabled(chat: Chat): Boolean = TaskRules.canCreate(chat)

    fun renameEnabled(bot: Bot, title: String): Boolean = TaskRules.canRename(bot)
    fun renameEnabled(chat: Chat, title: String): Boolean = TaskRules.canRename(chat)

    fun createTitle(raw: String): String? = raw.trim().ifEmpty { null }

    fun renameTitle(raw: String): String = raw
}
