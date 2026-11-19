// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import com.openmausbot.companion.R

import com.openmausbot.companion.core.AttachedMessageContent
import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.ChatSummary
import com.openmausbot.companion.core.ChatTarget
import com.openmausbot.companion.core.CompanionState
import com.openmausbot.companion.core.Message
import com.openmausbot.companion.core.OptionCard
import com.openmausbot.companion.core.PendingApproval
import com.openmausbot.companion.core.Reaction
import com.openmausbot.companion.core.Room
import com.openmausbot.companion.core.Session
import com.openmausbot.companion.core.chat
import com.openmausbot.companion.core.TranscriptRow
import com.openmausbot.companion.core.webhookContent

object ThreadResolution {
    sealed interface Result {
        data class Open(val chat: Chat) : Result

        data object Waiting : Result

        data object Gone : Result
    }

    fun hydrated(state: CompanionState): Boolean =
        state.cursor != null || state.bots.isNotEmpty() || state.rooms.isNotEmpty()

    fun chatOrNull(state: CompanionState, threadId: String): Chat? =
        (resolve(state, threadId) as? Result.Open)?.chat

    fun resolve(state: CompanionState, destination: Destination.Conversation): Result =
        when (destination) {
            is Destination.Chat -> when (val target = destination.target) {
                is ChatTarget.Bot -> state.chat(target)
                is ChatTarget.Room -> state.rooms.firstOrNull { it.id == target.roomId }?.let(Chat::RoomChat)
            }?.let(Result::Open) ?: unknown(state)
            is Destination.Thread -> resolve(state, destination.threadId)
        }

    fun resolve(state: CompanionState, threadId: String): Result {
        state.botForThread(threadId)?.let { return Result.Open(Chat.BotChat(it)) }
        state.roomForThread(threadId)?.let { return Result.Open(Chat.RoomChat(it)) }
        state.rooms
            .firstOrNull { room -> room.tasks.orEmpty().any { it.threadId == threadId } }
            ?.let { room -> state.chat(ChatTarget.Room(room.id, threadId)) }
            ?.let { return Result.Open(it) }
        return unknown(state)
    }

    private fun unknown(state: CompanionState): Result =
        if (hydrated(state)) Result.Gone else Result.Waiting
}

object TranscriptLayout {
    const val GAP_MILLIS: Double = 30.0 * 60.0 * 1000.0

    fun startsNewStretch(messages: List<Message>, index: Int): Boolean {
        if (index <= 0) return true
        if (index >= messages.size) return false
        return messages[index].at - messages[index - 1].at > GAP_MILLIS
    }

    fun startsNewRowStretch(rows: List<TranscriptRow>, index: Int): Boolean {
        if (index <= 0) return true
        if (index >= rows.size) return false
        return rows[index].at - rows[index - 1].endAt > GAP_MILLIS
    }

    fun endsRun(messages: List<Message>, index: Int): Boolean {
        val next = messages.getOrNull(index + 1) ?: return true
        val current = messages.getOrNull(index) ?: return true
        if (current.role != next.role) return true
        if (current.from?.name != next.from?.name) return true
        return next.kind != Message.Kind.TEXT
    }

    fun endsRowRun(rows: List<TranscriptRow>, index: Int): Boolean {
        val next = rows.getOrNull(index + 1) ?: return true
        val current = rows.getOrNull(index) ?: return true
        if (current.role != next.role) return true
        if (current.senderName != next.senderName) return true
        return next.kind != Message.Kind.TEXT
    }

    fun tail(message: Message, endsRun: Boolean): BubbleTail = when {
        !endsRun -> BubbleTail.NONE
        message.role == Message.Role.USER -> BubbleTail.TRAILING
        else -> BubbleTail.LEADING
    }
}

object SearchPolicy {
    const val MIN_LENGTH: Int = 2
    const val DEBOUNCE_MILLIS: Long = 250L

    sealed interface Decision {
        data object Clear : Decision

        data class Remote(val query: String) : Decision
    }

    fun decide(raw: String): Decision =
        if (raw.trim().length >= MIN_LENGTH) Decision.Remote(raw) else Decision.Clear

    fun matches(summary: ChatSummary, query: String): Boolean {
        if (query.isEmpty()) return true
        return summary.chat.name.contains(query, ignoreCase = true) ||
            summary.chat.subtitle.contains(query, ignoreCase = true) ||
            summary.preview.contains(query, ignoreCase = true)
    }

    fun filter(summaries: List<ChatSummary>, query: String): List<ChatSummary> =
        if (query.isEmpty()) summaries else summaries.filter { matches(it, query) }
}

enum class ChatActionId { PHOTOS, FILES, NEW_TASK, TASKS, WATCH_COMPUTER, SETTINGS, SHARE_MARKDOWN, SHARE_JSON, INTERRUPT }

data class ChatAction(
    val id: ChatActionId,
    @androidx.annotation.StringRes val title: Int,
    @androidx.annotation.StringRes val subtitle: Int,
    val subject: String? = null,
    val destructive: Boolean = false,
    val enabled: Boolean = true,
)

object ChatActions {
    fun sheet(chat: Chat, hasPendingApproval: Boolean, canAddAttachment: Boolean): List<ChatAction> {
        val bot = (chat as? Chat.BotChat)?.bot
        val out = mutableListOf<ChatAction>()
        out += ChatAction(
            id = ChatActionId.PHOTOS,
            title = R.string.chat_photo_library,
            subtitle = R.string.chat_add_a_photo_to_this_message,
            enabled = canAddAttachment,
        )
        out += ChatAction(
            id = ChatActionId.FILES,
            title = R.string.chat_choose_file,
            subtitle = R.string.chat_add_a_document_from_files,
            enabled = canAddAttachment,
        )
        if (bot != null) {
            out += ChatAction(
                id = ChatActionId.NEW_TASK,
                title = R.string.ui_new_thread,
                subtitle = R.string.chat_start_a_fresh_thread_with_1_s,
                subject = bot.name,
                enabled = TaskRules.canCreate(bot),
            )
            out += ChatAction(
                id = ChatActionId.TASKS,
                title = R.string.ui_threads,
                subtitle = R.string.chat_switch_rename_or_remove_one,
            )
            out += ChatAction(
                id = ChatActionId.SETTINGS,
                title = R.string.ui_bot_settings,
                subtitle = R.string.chat_model_profile_voice_and_notifications,
            )
            out += ChatAction(
                id = ChatActionId.WATCH_COMPUTER,
                title = R.string.chat_watch_computer,
                subtitle = R.string.chat_live_view_of_what_1_s_is_doing,
                subject = bot.name,
            )
        } else if (chat.supportsTasks) {
            out += ChatAction(
                id = ChatActionId.NEW_TASK,
                title = R.string.ui_new_thread,
                subtitle = R.string.chat_start_a_fresh_conversation_in_1_s,
                subject = chat.name,
                enabled = !chat.busy && !hasPendingApproval,
            )
            out += ChatAction(
                id = ChatActionId.TASKS,
                title = R.string.ui_threads,
                subtitle = R.string.chat_switch_rename_or_remove_one,
            )
        }
        out += ChatAction(
            id = ChatActionId.SHARE_MARKDOWN,
            title = R.string.chat_share_transcript,
            subtitle = R.string.chat_this_thread_as_markdown,
        )
        out += ChatAction(
            id = ChatActionId.SHARE_JSON,
            title = R.string.chat_share_as_json,
            subtitle = R.string.chat_structured_transcript_data,
        )
        if (chat.busy && bot != null) {
            out += ChatAction(
                id = ChatActionId.INTERRUPT,
                title = R.string.chat_interrupt,
                subtitle = R.string.chat_stop_the_current_turn,
                destructive = true,
            )
        }
        return out
    }
}

object RosterLayout {
    fun rows(summaries: List<ChatSummary>, query: String): List<ChatSummary> =
        SearchPolicy.filter(summaries, query)

    fun listsAnyBot(summaries: List<ChatSummary>): Boolean =
        summaries.any { it.chat is Chat.BotChat }

    fun showsGroups(query: String): Boolean = query.isEmpty()

    fun waitingChats(state: CompanionState, pending: List<PendingApproval>): Set<String> =
        pending.mapNotNullTo(mutableSetOf()) {
            ThreadResolution.chatOrNull(state, it.threadId)?.id
        }

    fun memberBots(state: CompanionState, room: Room): List<Bot> =
        room.memberIds.mapNotNull { state.bot(it) }

    fun headerSubtitle(connectionName: String?, status: Session.Status): String {
        val name = connectionName ?: NOT_PAIRED
        return when (status) {
            Session.Status.Live -> "$name · connected"
            Session.Status.Connecting -> "$name · connecting…"
            is Session.Status.Offline -> "$name · offline"
            Session.Status.Unauthorized -> "$name · unpaired"
            Session.Status.Unpaired -> NOT_PAIRED
        }
    }

    fun sectionLabel(text: String): String = text.uppercase()

    private const val NOT_PAIRED = "Not paired"
}

data class RosterBar(val searchOpen: Boolean = false, val query: String = "") {
    fun openSearch(): RosterBar = copy(searchOpen = true)

    fun cancelSearch(): RosterBar = RosterBar(searchOpen = false, query = "")

    fun typed(text: String): RosterBar = copy(query = text)

    fun clearQuery(): RosterBar = copy(query = "")
}

enum class OptionEmphasis {
    PRIMARY,

    SECONDARY,
}

// A standing grant may answer only with an option offered by the approval card.
object ApprovalChoices {
    const val ALLOW = "Allow"


    fun isRefusal(option: String): Boolean = OptionCard.isRefusal(option)

    fun emphasis(option: String): OptionEmphasis =
        if (isRefusal(option)) OptionEmphasis.SECONDARY else OptionEmphasis.PRIMARY

    fun allowChoice(options: List<String>): String? =
        options.firstOrNull { it.equals(ALLOW, ignoreCase = true) }
            ?: options.firstOrNull { !isRefusal(it) }


    fun alwaysAllowChoice(card: OptionCard): String? =
        if (!card.isPending || card.allowKey == null) null else allowChoice(card.options)

    /**
     * "Always allow this tool" needs a key the card itself carried and a bot to
     * hang it on — the phone never invents a grant, and rooms never show one
     * (§12).
     */
    fun showsAlwaysAllow(card: OptionCard, chat: Chat): Boolean =
        chat is Chat.BotChat && alwaysAllowChoice(card) != null
}

// One explicit standing-grant action must not persist duplicate permission grants.
object ApprovalAnswers {
    suspend fun choose(session: Session, chat: Chat, card: OptionCard, choice: String) {
        session.answer(chat, card, choice)
    }

    suspend fun grant(session: Session, chat: Chat.BotChat, card: OptionCard, choice: String) {
        session.grantAndAnswer(chat, card, choice)
    }
}

object SearchHitRole {
    fun isFromUser(role: Message.Role): Boolean = role == Message.Role.USER

    fun contentDescription(role: Message.Role, name: String): String =
        if (isFromUser(role)) "Your message" else "Message from $name"
}

object MessageActions {
    fun copyableText(message: Message): String? = when (message.kind) {
        Message.Kind.TEXT, Message.Kind.UNKNOWN -> message.text
            ?.let { message.webhookContent?.task ?: AttachedMessageContent.parse(it).text }
            ?.takeIf { it.isNotBlank() }
        Message.Kind.OPTIONS -> message.card
            ?.let { card -> listOf(card.title, card.subtitle).filter { it.isNotBlank() } }
            ?.takeIf { it.isNotEmpty() }
            ?.joinToString("\n\n")
        Message.Kind.ACTIVITY, Message.Kind.SCREEN, Message.Kind.DIGEST -> null
        Message.Kind.COMPACTION -> message.compaction?.summary ?: message.text?.takeIf { it.isNotBlank() }
    }

    fun editableText(message: Message): String? {
        if (message.role != Message.Role.USER || message.kind != Message.Kind.TEXT) return null
        if (message.webhookContent != null) return null
        val raw = message.text ?: return null
        if (AttachedMessageContent.parse(raw).attachments.isNotEmpty()) return null
        return raw
    }
}

data class ReactionGroup(val emoji: String, val count: Int, val mine: Boolean)

object Reactions {
    val CHOICES: List<String> = listOf("👍", "❤️", "😂", "🎉", "👀")

    fun group(reactions: List<Reaction>): List<ReactionGroup> =
        reactions.groupBy { it.emoji }
            .map { (emoji, all) -> ReactionGroup(emoji, all.size, all.any { it.by == "user" }) }
            .sortedBy { it.emoji }
}

enum class SlashCommandId { COMPUTER, TASKS, DIFF, RETRY, STEER }

sealed interface SlashEffect {
    data object OpenComputer : SlashEffect

    data object OpenTasks : SlashEffect

    data class Send(@param:androidx.annotation.StringRes val prompt: Int) : SlashEffect
}

data class SlashCommand(
    val id: SlashCommandId,
    val title: String,
    @param:androidx.annotation.StringRes val description: Int,
    val effect: SlashEffect,
)

object SlashCommands {
    val ALL: List<SlashCommand> = listOf(
        SlashCommand(
            id = SlashCommandId.COMPUTER,
            title = "/computer",
            description = R.string.ui_command_computer,
            effect = SlashEffect.OpenComputer,
        ),
        SlashCommand(
            id = SlashCommandId.TASKS,
            title = "/threads",
            description = R.string.ui_command_threads,
            effect = SlashEffect.OpenTasks,
        ),
        SlashCommand(
            id = SlashCommandId.DIFF,
            title = "/diff",
            description = R.string.ui_command_diff,
            effect = SlashEffect.Send(R.string.ui_diff_prompt),
        ),
        SlashCommand(
            id = SlashCommandId.RETRY,
            title = "/retry",
            description = R.string.ui_command_retry,
            effect = SlashEffect.Send(R.string.ui_retry_prompt),
        ),
        SlashCommand(
            id = SlashCommandId.STEER,
            title = "/steer",
            description = R.string.ui_command_steer,
            effect = SlashEffect.Send(R.string.ui_steer_prompt),
        ),
    )

    val IN_ROOM: List<SlashCommand> = ALL.filterNot { it.id == SlashCommandId.COMPUTER }

    val IN_LEGACY_ROOM: List<SlashCommand> = IN_ROOM.filterNot { it.id == SlashCommandId.TASKS }

    fun forChat(chat: Chat): List<SlashCommand> = when (chat) {
        is Chat.BotChat -> ALL
        is Chat.RoomChat -> if (chat.supportsTasks) IN_ROOM else IN_LEGACY_ROOM
    }

    fun opensOnDraft(draft: String): Boolean = draft.startsWith("/")

    fun openOnEntry(restoredDraft: String): Boolean = opensOnDraft(restoredDraft)

    fun matching(commands: List<SlashCommand>, draft: String, describe: (Int) -> String): List<SlashCommand> {
        if (!draft.startsWith("/") || draft.length <= 1) return commands
        val query = draft.drop(1).lowercase()
        return commands.filter {
            it.title.lowercase().contains(query) || describe(it.description).lowercase().contains(query)
        }
    }

    fun draftAfterClose(draft: String): String = if (draft == "/") "" else draft
}

data class PredictiveChip(val title: String, val prompt: String, val icon: String? = null)

object PredictiveChips {
    val ALL: List<PredictiveChip> = listOf(
        PredictiveChip("Show diff", "Show latest git diff", "diff"),
        PredictiveChip("Run tests", "Run all automated tests", "tests"),
        PredictiveChip("Explain steps", "Explain the changes in detail", "explain"),
        PredictiveChip("What's next?", "What should we do next?", "next"),
    )
}

enum class ComposerAccessory { HUD, CHIPS, NONE }

object ComposerAccessories {
    fun hasPendingApproval(messages: List<Message>): Boolean =
        messages.any { it.card?.isPending == true }

    fun accessory(
        hudOpen: Boolean,
        draft: String,
        busy: Boolean,
        pendingApproval: Boolean,
        hasQuickReplies: Boolean,
        hasAttachments: Boolean,
    ): ComposerAccessory = when {
        hudOpen -> ComposerAccessory.HUD
        draft.isEmpty() && !hasAttachments && !busy && !pendingApproval && hasQuickReplies -> ComposerAccessory.CHIPS
        else -> ComposerAccessory.NONE
    }
}
