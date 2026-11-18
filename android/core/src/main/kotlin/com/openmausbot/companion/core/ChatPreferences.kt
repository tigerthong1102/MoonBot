// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.core

import java.util.UUID
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString

enum class ActivityDetail(val wireValue: String, val label: String, val caption: String) {
    FULL("full", "Full", "Every step a bot takes."),
    REDUCED("reduced", "Reduced", "Steps fold into one line. Failures always show."),
    HIDDEN("hidden", "Hidden", "No activity, only messages."),
    ;

    companion object {
        fun fromWire(value: String?): ActivityDetail =
            entries.firstOrNull { it.wireValue == value } ?: FULL
    }
}

@Serializable
data class QuickReply(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val prompt: String,
    val icon: String,
) {
    companion object {
        val DEFAULTS: List<QuickReply> = listOf(
            QuickReply("default.diff", "Show diff", "Show latest git diff", "diff"),
            QuickReply("default.tests", "Run tests", "Run all automated tests", "tests"),
            QuickReply("default.explain", "Explain steps", "Explain the changes in detail", "explain"),
            QuickReply("default.next", "What's next?", "What should we do next?", "next"),
        )

        val ICON_CHOICES: List<String> = listOf(
            "next", "diff", "tests", "explain", "build", "bug", "document", "terminal",
            "send", "search", "history", "list",
        )

        fun encode(replies: List<QuickReply>): String =
            runCatching { CompanionJson.encodeToString(replies) }.getOrDefault("")

        fun decode(json: String): List<QuickReply> {
            if (json.isEmpty()) return DEFAULTS
            val decoded = runCatching {
                CompanionJson.decodeFromString<List<QuickReply>>(json)
            }.getOrElse { return DEFAULTS }
            val ids = decoded.map { it.id.trim() }
            if (ids.any(String::isEmpty) || ids.toSet().size != ids.size) return DEFAULTS
            return decoded
        }
    }
}

sealed interface TranscriptRow {
    val head: Message
    val id: String
    val at: Double get() = head.at
    val endAt: Double
    val role: Message.Role get() = head.role
    val kind: Message.Kind get() = head.kind
    val senderName: String? get() = head.from?.name

    fun containsMessage(messageId: String): Boolean = when (this) {
        is Single -> message.id == messageId
        is ActivityRun -> items.any { it.id == messageId }
        is AssistantTurn -> items.any { it.id == messageId }
    }

    data class Single(val message: Message) : TranscriptRow {
        override val head: Message get() = message
        override val id: String get() = message.id
        override val endAt: Double get() = message.at
    }

    data class ActivityRun(val items: List<Message>) : TranscriptRow {
        init {
            require(items.isNotEmpty()) { "An activity run must contain at least one message." }
        }

        override val head: Message get() = items.first()
        override val id: String get() = "run.${head.id}"
        override val endAt: Double get() = items.last().at
        val running: Boolean get() = items.any { it.tool?.ok == null }
    }

    data class AssistantTurn(val turnId: String, val items: List<Message>, val elapsed: Double) : TranscriptRow {
        init {
            require(items.isNotEmpty()) { "A turn fold must contain narration." }
        }

        override val head: Message get() = items.first()
        override val id: String get() = "turn.$turnId"
        override val endAt: Double get() = items.last().at
        val label: String get() {
            if (elapsed < 1_000) return "Worked"
            val seconds = (elapsed / 1_000).toLong()
            val duration = if (seconds < 60) "${seconds}s"
                else "${seconds / 60}m ${(seconds % 60).toString().padStart(2, '0')}s"
            return "Worked for $duration"
        }
    }
}

fun rosterPreview(messages: List<Message>, detail: ActivityDetail): String =
    when (val last = transcriptRows(messages, detail).lastOrNull()) {
        null -> ""
        is TranscriptRow.Single -> previewText(last.message)
        is TranscriptRow.ActivityRun ->
            "${if (last.running) "Running" else "Ran"} ${last.items.size} steps"
        is TranscriptRow.AssistantTurn -> last.label
    }

internal fun previewText(message: Message): String = when (message.kind) {
    Message.Kind.TEXT -> message.webhookContent?.task ?: message.text.orEmpty()
    Message.Kind.OPTIONS -> {
        val card = message.card
        when {
            card == null -> ""
            card.isPending && card.subtitle.isNotEmpty() -> card.subtitle
            else -> card.title
        }
    }
    Message.Kind.ACTIVITY -> message.tool?.name.orEmpty()
    Message.Kind.SCREEN -> "Screenshot"
    Message.Kind.DIGEST -> ""
    Message.Kind.COMPACTION -> message.compaction?.chipText ?: message.text.orEmpty()
    Message.Kind.UNKNOWN -> message.text.orEmpty()
}

fun isActivityReceipt(message: Message): Boolean = when (message.kind) {
    Message.Kind.ACTIVITY, Message.Kind.DIGEST, Message.Kind.COMPACTION -> true
    else -> false
}

fun transcriptRows(messages: List<Message>, detail: ActivityDetail): List<TranscriptRow> {
    val narration = mutableMapOf<String, MutableList<Message>>()
    val startedAt = mutableMapOf<String, Double>()
    var lastUserAt: Double? = null
    val folds = mutableMapOf<String, TranscriptRow.AssistantTurn>()
    val hiddenIds = mutableSetOf<String>()
    for (message in messages) {
        if (message.role == Message.Role.USER) lastUserAt = message.at
        val turnId = message.turnId?.takeIf { it.isNotEmpty() } ?: continue
        if (message.role != Message.Role.BOT || message.kind != Message.Kind.TEXT) continue
        if (message.turnTerminal == true) {
            val items = narration.remove(turnId)?.takeIf { it.isNotEmpty() } ?: continue
            folds[items.first().id] = TranscriptRow.AssistantTurn(
                turnId, items.toList(), (message.at - (startedAt[turnId] ?: items.first().at)).coerceAtLeast(0.0),
            )
            hiddenIds.addAll(items.map { it.id })
        } else {
            if (turnId !in narration) startedAt[turnId] = lastUserAt ?: message.at
            narration.getOrPut(turnId) { mutableListOf() }.add(message)
        }
    }
    return buildList {
        val run = mutableListOf<Message>()
        fun flush() {
            when (run.size) {
                0 -> Unit
                1 -> add(TranscriptRow.Single(run.single()))
                else -> add(TranscriptRow.ActivityRun(run.toList()))
            }
            run.clear()
        }

        messages.forEach { message ->
            if (message.kind == Message.Kind.DIGEST) return@forEach
            val turn = folds[message.id]
            if (turn != null) {
                flush()
                add(turn)
            } else if (message.id in hiddenIds || (detail == ActivityDetail.HIDDEN && isActivityReceipt(message))) {
            } else if (detail != ActivityDetail.REDUCED || message.kind != Message.Kind.ACTIVITY) {
                flush()
                add(TranscriptRow.Single(message))
            } else if (message.tool?.ok == false) {
                flush()
                add(TranscriptRow.Single(message))
            } else {
                run += message
            }
        }
        flush()
    }
}
