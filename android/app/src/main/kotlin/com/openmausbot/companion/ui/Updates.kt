// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.runtime.Immutable
import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.CompanionState
import com.openmausbot.companion.core.Message
import com.openmausbot.companion.core.OptionCard
import com.openmausbot.companion.core.PendingApproval
import com.openmausbot.companion.core.forTask
import com.openmausbot.companion.core.takeLastCharacters
import com.openmausbot.companion.core.visibleTasks

internal enum class UpdateKind { NEEDS_YOU, WORKING, TO_REVIEW }

@Immutable
internal data class ChatUpdate(
    val chat: Chat,
    val kind: UpdateKind,
    val line: String,
    val card: OptionCard? = null,
) {
    val id: String get() = chat.conversationId
}

internal val CompanionState.updates: List<ChatUpdate>
    get() = updates(pendingApprovals)

internal fun CompanionState.updates(pending: List<PendingApproval>): List<ChatUpdate> {
    val out = mutableListOf<ChatUpdate>()
    val seen = mutableSetOf<String>()

    for (approval in pending) {
        val chat = ThreadResolution.chatOrNull(this, approval.threadId) ?: continue
        if (!seen.add(chat.conversationId)) continue
        val card = approval.message.card
        out += ChatUpdate(chat, UpdateKind.NEEDS_YOU, card?.subtitle.orEmpty(), card)
    }

    for (bot in bots) {
        if (bot.hidden == true) continue
        val conversations = if (bot.tasks == null) listOf(bot)
            else bot.visibleTasks.mapNotNull { bot.forTask(it.threadId) }
        for (conversation in conversations) {
            val chat = Chat.BotChat(conversation)
            if (!seen.add(chat.conversationId)) continue
            val held = pendingQueued[conversation.threadId]?.size ?: 0
            when {
                conversation.activity == "waiting-on-you" ->
                    out += ChatUpdate(chat, UpdateKind.NEEDS_YOU, "Waiting on you")
                held > 0 ->
                    out += ChatUpdate(
                        chat, UpdateKind.WORKING,
                        if (held == 1) "Queued — waiting for an available slot" else "$held messages queued",
                    )
                conversation.busy == true ->
                    out += ChatUpdate(chat, UpdateKind.WORKING, workingLine(chat.threadId))
                conversation.unread ->
                    out += ChatUpdate(chat, UpdateKind.TO_REVIEW, lastLine(chat.threadId))
            }
        }
    }

    for (room in rooms) {
        val threads = room.tasks?.map { it.threadId } ?: listOf(room.threadId)
        for (thread in threads) {
            val projected = room.forTask(thread) ?: continue
            val chat = Chat.RoomChat(projected)
            if (!seen.add(chat.conversationId)) continue
            val held = pendingQueued[thread]?.size ?: 0
            when {
                held > 0 -> out += ChatUpdate(
                    chat, UpdateKind.WORKING,
                    if (held == 1) "Queued — waiting for an available slot" else "$held messages queued",
                )
                projected.busyBotId != null -> out += ChatUpdate(chat, UpdateKind.WORKING, workingLine(thread))
                projected.unread -> out += ChatUpdate(chat, UpdateKind.TO_REVIEW, lastLine(thread))
            }
        }
    }

    return out.sortedBy(ChatUpdate::kind)
}

private fun CompanionState.workingLine(threadId: String): String {
    val live = streaming[threadId]
    if (!live.isNullOrEmpty()) return live.takeLastCharacters(STREAM_TAIL).replace('\n', ' ')
    val last = visibleTranscript(threadId).lastOrNull()
    if (last?.kind == Message.Kind.ACTIVITY) last.tool?.let { return it.name }
    return WORKING_LINE
}

private fun CompanionState.lastLine(threadId: String): String {
    val last = visibleTranscript(threadId).lastOrNull() ?: return ""
    return when (last.kind) {
        Message.Kind.TEXT, Message.Kind.UNKNOWN -> last.text.orEmpty()
        Message.Kind.OPTIONS -> last.card?.title.orEmpty()
        Message.Kind.ACTIVITY -> last.tool?.name.orEmpty()
        Message.Kind.SCREEN -> "Screenshot"
        Message.Kind.DIGEST -> ""
        Message.Kind.COMPACTION -> last.compaction?.chipText ?: last.text.orEmpty()
    }
}

private const val STREAM_TAIL = 120

private const val WORKING_LINE = "Working…"

internal object UpdatesSummary {
    const val MASCOTS = 3

    const val EMPTY_TITLE = "Nothing needs you"
    const val EMPTY_DESCRIPTION =
        "When a bot stops for an answer, is mid-task, or finishes something, it shows up here."

    fun headline(updates: List<ChatUpdate>): String {
        val first = updates.firstOrNull() ?: return "All quiet"
        return when (first.kind) {
            UpdateKind.NEEDS_YOU -> "${first.chat.name} needs you"
            UpdateKind.WORKING -> "${first.chat.name} is working"
            UpdateKind.TO_REVIEW -> "${first.chat.name} has an update"
        }
    }

    fun subline(updates: List<ChatUpdate>): String {
        val first = updates.firstOrNull() ?: return "Nothing needs you"
        val rest = updates.size - 1
        if (rest == 0) return first.line.ifEmpty { " " }
        return if (rest == 1) "1 more update" else "$rest more updates"
    }

    fun count(updates: List<ChatUpdate>): String =
        if (updates.isEmpty()) "All quiet" else "${updates.size} active"

    fun section(kind: UpdateKind): String = when (kind) {
        UpdateKind.NEEDS_YOU -> "Needs you"
        UpdateKind.WORKING -> "Working"
        UpdateKind.TO_REVIEW -> "To review"
    }

    fun sectionLabel(kind: UpdateKind): String = section(kind).uppercase()
}
