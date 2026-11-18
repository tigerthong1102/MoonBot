// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.NotificationTarget
import com.openmausbot.companion.core.Session
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class NotificationTapCoordinator {
        data class Resolution(
        val generation: Long,
        val chat: Chat,
        val target: NotificationTarget,
    )

    private var nextGeneration = 0L
    private val _resolution = MutableStateFlow<Resolution?>(null)
    val resolution: StateFlow<Resolution?> = _resolution.asStateFlow()

        suspend fun onPending(
        session: Session,
        target: NotificationTarget,
        consume: (NotificationTarget) -> Unit,
    ): Boolean {
        val result = NotificationOpen.open(session, target)
        nextGeneration += 1
        _resolution.value = result.chat?.let { chat ->
            Resolution(generation = nextGeneration, chat = chat, target = target)
        }
        val consumeNow = result.consumed && result.chat == null
        if (consumeNow) consume(target)
        return consumeNow
    }

        fun discardResolved() {
        nextGeneration += 1
        _resolution.value = null
    }

        fun commit(
        expected: Resolution,
        navigator: CompanionNavigator,
        connectionId: String?,
        consume: (NotificationTarget) -> Unit,
    ): Boolean {
        val current = _resolution.value
        if (current == null || current.generation != expected.generation) return false
        if (current.target.connectionId != connectionId) {
            _resolution.value = null
            consume(current.target)
            return false
        }
        navigator.openFromNotification(current.chat)
        val target = current.target
        _resolution.value = null
        consume(target)
        return true
    }

    companion object {
                fun leavesBond(status: Session.Status): Boolean =
            status is Session.Status.Unpaired || status is Session.Status.Unauthorized
    }
}
