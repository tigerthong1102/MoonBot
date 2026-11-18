// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.notifications

import com.openmausbot.companion.core.NotificationFrame

object NotificationMapping {
    const val CHANNEL_BLOCKING = "approval_question"
        const val CHANNEL_DONE = "bot_messages"
    const val CHANNEL_ROUTINE_FAILED = "routine_failed"

    fun channelId(notification: NotificationFrame): String = when (notification.kind) {
        "approval", "question" -> CHANNEL_BLOCKING
        "routine-failed" -> CHANNEL_ROUTINE_FAILED
        else -> CHANNEL_DONE
    }

        fun dedupeId(notification: NotificationFrame, sequence: Int?, connectionId: String): String {
        val suffix = sequence?.toString() ?: notification.title
        return "startupbot.${connectionId.length}:$connectionId${notification.threadId.length}:${notification.threadId}.$suffix"
    }

    fun isHighImportance(notification: NotificationFrame): Boolean = notification.isBlocking
}
