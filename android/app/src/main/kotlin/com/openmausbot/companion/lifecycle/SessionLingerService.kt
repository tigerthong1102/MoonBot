// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.lifecycle

import android.app.Service
import android.content.Intent
import android.os.IBinder
import java.util.concurrent.atomic.AtomicReference


class SessionLingerService : Service() {
    private var token = NO_TOKEN

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val supplied = intent?.getLongExtra(EXTRA_TOKEN, NO_TOKEN) ?: NO_TOKEN
        if (supplied != NO_TOKEN) token = supplied
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        val destroyed = token
        token = NO_TOKEN
        super.onDestroy()
        if (destroyed != NO_TOKEN) watcher.get()?.onAnchorDestroyed(destroyed)
    }

    fun interface Watcher {
        fun onAnchorDestroyed(token: Long)
    }

    companion object {
        const val EXTRA_TOKEN = "com.openmausbot.companion.linger.TOKEN"
        const val NO_TOKEN = 0L

        private val watcher = AtomicReference<Watcher?>(null)

        fun watch(watcher: Watcher?) {
            this.watcher.set(watcher)
        }
    }
}
