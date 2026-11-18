// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.NotificationTarget
import com.openmausbot.companion.core.Session

// A temporarily unavailable credential store does not establish that pairing has been revoked.
object NotificationOpen {

    /**
     * Credential restore still in flight or waiting on secure storage: call
     * [Session.connect] and keep the pending target — do not invoke
     * [Session.openNotification].
     */
    fun shouldDefer(session: Session): Boolean =
        session.restoreState.value is Session.RestoreState.Pending

    fun canOpen(session: Session): Boolean = when (session.status.value) {
        is Session.Status.Connecting,
        is Session.Status.Live,
        -> true
        is Session.Status.Offline ->
            session.connection.value != null && !shouldDefer(session)
        else -> false
    }

    suspend fun open(
        session: Session,
        target: NotificationTarget,
    ): Result {
        if (shouldDefer(session)) {
            session.connect()
            return Result(chat = null, consumed = false)
        }
        if (!canOpen(session)) {
            return Result(chat = null, consumed = true)
        }
        val chat = session.openNotification(target)
        return Result(chat = chat, consumed = true)
    }

    data class Result(val chat: Chat?, val consumed: Boolean)
}
