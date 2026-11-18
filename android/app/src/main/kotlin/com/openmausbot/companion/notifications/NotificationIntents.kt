// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.notifications

import android.content.Intent
import android.net.Uri
import com.openmausbot.companion.MainActivity
import com.openmausbot.companion.core.NotificationFrame
import com.openmausbot.companion.core.NotificationTarget

fun Intent.notificationTarget(): NotificationTarget? =
    NotificationTarget.from(
        getStringExtra(LocalNotificationPoster.EXTRA_BOT_ID),
        getStringExtra(LocalNotificationPoster.EXTRA_THREAD_ID),
        getStringExtra(LocalNotificationPoster.EXTRA_CONNECTION_ID),
    )

object NotificationIntents {
    const val ACTION_OPEN = "com.openmausbot.companion.OPEN_NOTIFICATION"

    fun contentIdentity(botId: String, threadId: String, connectionId: String): String =
        "startupbot://notification/${encode(connectionId)}/${encode(botId)}/${encode(threadId)}"

    fun contentUri(botId: String, threadId: String, connectionId: String): Uri =
        Uri.parse(contentIdentity(botId, threadId, connectionId))

    fun contentIntent(
        packageContext: android.content.Context,
        notification: NotificationFrame,
        connectionId: String,
    ): Intent = Intent(packageContext, MainActivity::class.java).apply {
        action = ACTION_OPEN
        data = contentUri(notification.botId, notification.threadId, connectionId)
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        putExtra(LocalNotificationPoster.EXTRA_THREAD_ID, notification.threadId)
        putExtra(LocalNotificationPoster.EXTRA_BOT_ID, notification.botId)
        putExtra(LocalNotificationPoster.EXTRA_KIND, notification.kind)
        putExtra(LocalNotificationPoster.EXTRA_CONNECTION_ID, connectionId)
    }

    private fun encode(value: String): String = Uri.encode(value)
}
