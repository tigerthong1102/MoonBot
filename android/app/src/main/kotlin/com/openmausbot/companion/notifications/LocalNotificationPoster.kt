// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.openmausbot.companion.R
import com.openmausbot.companion.core.NotificationFrame
import com.openmausbot.companion.core.NotificationSink

class LocalNotificationPoster(
    context: Context,
) : NotificationSink {
    private val appContext = context.applicationContext
    private val manager = NotificationManagerCompat.from(appContext)

    init {
        ensureChannels()
    }

    override fun deliver(notification: NotificationFrame, sequence: Int?, connectionId: String, computerName: String) {
        if (!canPost()) return
        val channelId = NotificationMapping.channelId(notification)
        val intent = NotificationIntents.contentIntent(appContext, notification, connectionId)
        val pending = PendingIntent.getActivity(
            appContext,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val title = NotificationText.anchored(notification.title)
        val body = NotificationText.anchored(notification.body)
        val builder = NotificationCompat.Builder(appContext, channelId)
            .setSmallIcon(R.drawable.ic_startupbot_status)
            .setSubText(computerName.trim().take(80).ifBlank { null })
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setNumber(lastBadge)
            .setPriority(
                if (NotificationMapping.isHighImportance(notification)) {
                    NotificationCompat.PRIORITY_HIGH
                } else {
                    NotificationCompat.PRIORITY_DEFAULT
                },
            )
            .setCategory(
                if (notification.isBlocking) NotificationCompat.CATEGORY_ALARM
                else NotificationCompat.CATEGORY_STATUS,
            )
        try {
            manager.notify(NotificationMapping.dedupeId(notification, sequence, connectionId), 0, builder.build())
        } catch (_: SecurityException) {
            // Permission can be revoked between canPost() and notify(). A missed
            // local banner is safer than crashing the live companion session.
        }
    }

    override fun setBadge(count: Int) {
        lastBadge = maxOf(0, count)
    }

    @Volatile
    var lastBadge: Int = 0
        private set

    fun ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val system = appContext.getSystemService(NotificationManager::class.java) ?: return

        if (system.getNotificationChannel(NotificationMapping.CHANNEL_BLOCKING) == null) {
            system.createNotificationChannel(
                NotificationChannel(
                    NotificationMapping.CHANNEL_BLOCKING,
                    appContext.getString(R.string.notification_channel_blocking),
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = appContext.getString(R.string.notification_channel_blocking_desc)
                },
            )
        }

        if (system.getNotificationChannel(NotificationMapping.CHANNEL_DONE) == null) {
            val legacyDone = system.getNotificationChannel(LEGACY_CHANNEL_DONE)
            val doneImportance = if (legacyDone != null &&
                legacyDone.importance < NotificationManager.IMPORTANCE_DEFAULT
            ) {
                legacyDone.importance
            } else {
                NotificationManager.IMPORTANCE_HIGH
            }
            system.createNotificationChannel(
                NotificationChannel(
                    NotificationMapping.CHANNEL_DONE,
                    appContext.getString(R.string.notification_channel_done),
                    doneImportance,
                ).apply {
                    description = appContext.getString(R.string.notification_channel_done_desc)
                    if (legacyDone != null) {
                        setSound(legacyDone.sound, legacyDone.audioAttributes)
                        enableVibration(legacyDone.shouldVibrate())
                        vibrationPattern = legacyDone.vibrationPattern
                        lockscreenVisibility = legacyDone.lockscreenVisibility
                    }
                },
            )
        }
        system.deleteNotificationChannel(LEGACY_CHANNEL_DONE)

        if (system.getNotificationChannel(NotificationMapping.CHANNEL_ROUTINE_FAILED) == null) {
            system.createNotificationChannel(
                NotificationChannel(
                    NotificationMapping.CHANNEL_ROUTINE_FAILED,
                    appContext.getString(R.string.notification_channel_routine),
                    NotificationManager.IMPORTANCE_DEFAULT,
                ).apply {
                    description = appContext.getString(R.string.notification_channel_routine_desc)
                },
            )
        }
    }

        fun canPost(): Boolean {
        if (!manager.areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT < 33) return true
        return ContextCompat.checkSelfPermission(
            appContext,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

        fun needsNotificationPermission(): Boolean =
        Build.VERSION.SDK_INT >= 33 && !canPost()

    companion object {
        const val EXTRA_THREAD_ID = "openmaus.threadId"
        const val EXTRA_CONNECTION_ID = "startupbot.connectionId"
        const val EXTRA_BOT_ID = "openmaus.botId"
        const val EXTRA_KIND = "openmaus.kind"

                const val POST_NOTIFICATIONS_PERMISSION = Manifest.permission.POST_NOTIFICATIONS

                private const val LEGACY_CHANNEL_DONE = "done"
    }
}
