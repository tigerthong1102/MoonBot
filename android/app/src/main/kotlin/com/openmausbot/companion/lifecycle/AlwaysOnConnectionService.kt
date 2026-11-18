// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.lifecycle

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.openmausbot.companion.OpenMausApp
import com.openmausbot.companion.R

// Android foreground services require a visible notification. START_STICKY restarts may receive a null Intent.
class AlwaysOnConnectionService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification())
        AlwaysOnConnectionState.active = true
        val app = application as OpenMausApp
        app.linger.onAlwaysOnStarted()
        app.session.connect()
        return START_STICKY
    }

    override fun onDestroy() {
        AlwaysOnConnectionState.active = false
        super.onDestroy()
    }

    private fun buildNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_startupbot_status)
            .setContentTitle(getString(R.string.always_on_notification_title))
            .setContentText(getString(R.string.always_on_notification_text))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val system = getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel_always_on),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.notification_channel_always_on_desc)
            setShowBadge(false)
        }
        system.createNotificationChannel(channel)
    }

    companion object {
        const val CHANNEL_ID = "always_on_status"
        const val NOTIFICATION_ID = 1

        fun start(context: Context) {
            androidx.core.content.ContextCompat.startForegroundService(
                context,
                Intent(context, AlwaysOnConnectionService::class.java),
            )
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, AlwaysOnConnectionService::class.java))
        }
    }
}
