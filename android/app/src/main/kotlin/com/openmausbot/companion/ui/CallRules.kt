// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import com.openmausbot.companion.core.Message
import com.openmausbot.companion.core.Bot
import com.openmausbot.companion.core.CompanionState

enum class CallPhase { LISTENING, SENDING, WORKING, SPEAKING }

sealed class CallAction {
    data class Announce(val text: String) : CallAction()

    data class SayReply(val text: String) : CallAction()

    data class SayChip(val text: String) : CallAction()

    data object StopListeningAndWork : CallAction()

    data object Listen : CallAction()

    data object None : CallAction()
}

/** The microphone must stay closed during playback to prevent a speech feedback loop. */
object CallRules {
    fun botForCall(state: CompanionState, original: Bot): Bot? =
        state.botForThread(original.threadId)?.takeIf { it.id == original.id }

    fun failedSendAction(active: Boolean, busy: Boolean, speaking: Boolean): CallAction = when {
        !active || speaking -> CallAction.None
        busy -> CallAction.StopListeningAndWork
        else -> CallAction.Listen
    }

    const val ENDPOINT_GAP_MILLIS: Long = 850L

    fun phaseText(phase: CallPhase, name: String): String = when (phase) {
        CallPhase.LISTENING -> "Listening…"
        CallPhase.SENDING -> "Sending…"
        CallPhase.WORKING -> "$name is working…"
        CallPhase.SPEAKING -> "Speaking"
    }

    fun noVoiceNote(name: String): String = "Set up a voice in Settings → Voice to hear $name."

    /**
     * Approvals and questions are announced, not answered by voice: saying
     * "yes" to a permission is not the kind of thing to infer from a sentence
     * that happened to contain the word.
     */
    fun announcement(name: String, isPermission: Boolean): String =
        "$name ${if (isPermission) "is asking for permission" else "has a question"}. Open the chat to answer it."

    fun react(
        name: String,
        fresh: List<Message>,
        pendingCard: Message?,
        announced: Set<String>,
        phase: CallPhase,
        busy: Boolean,
        speakerSpeaking: Boolean,
    ): CallAction {
        val request = pendingCard?.card?.requestId
        if (pendingCard != null && request != null && request !in announced && phase != CallPhase.SPEAKING) {
            return CallAction.Announce(announcement(name, pendingCard.card?.tool != null))
        }
        val reply = fresh.lastOrNull {
            it.role == Message.Role.BOT && it.kind == Message.Kind.TEXT && !it.text.isNullOrBlank()
        }
        if (reply != null) return CallAction.SayReply(reply.text.orEmpty())
        val chip = fresh.lastOrNull { it.kind == Message.Kind.ACTIVITY && it.tool?.spoken != null }
        if (chip != null && phase == CallPhase.WORKING) return CallAction.SayChip(chip.tool?.spoken.orEmpty())
        if (busy) {
            return if (phase == CallPhase.LISTENING || phase == CallPhase.SENDING) {
                CallAction.StopListeningAndWork
            } else {
                CallAction.None
            }
        }
        if ((phase == CallPhase.WORKING || phase == CallPhase.SENDING) && !speakerSpeaking) return CallAction.Listen
        return CallAction.None
    }
}
