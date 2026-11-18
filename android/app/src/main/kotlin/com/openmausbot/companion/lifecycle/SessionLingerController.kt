// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.lifecycle

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.openmausbot.companion.core.Session
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Android may destroy a background service or process under memory pressure; its grace window is not guaranteed.
class SessionLingerController(
    private val session: Session,
    private val scope: CoroutineScope,
    private val anchor: ProcessAnchor,
    private val alwaysOn: () -> Boolean = { false },
) : DefaultLifecycleObserver {

    /**
     * Whatever keeps the process out of the `cached` class for one window.
     *
     * Production is a started [SessionLingerService]; tests substitute this and
     * nothing else, so the real [Session], the real `delay` and the real SSE
     * collection stay under test.
     */
    interface ProcessAnchor {
        fun attach(controller: SessionLingerController)

        fun start(token: Long): Boolean

        fun stop(token: Long)
    }

    private var openToken: Long? = null
    private var nextToken = 1L
    private var timer: Job? = null
    private var foreground = false

    val openWindow: Long? get() = openToken

    override fun onStart(owner: LifecycleOwner) {
        foreground = true
        val closing = openToken
        openToken = null
        timer?.cancel()
        timer = null
        if (closing != null) anchor.stop(closing)
        session.connect()
    }

    override fun onStop(owner: LifecycleOwner) {
        foreground = false
        if (alwaysOn()) return
        if (openToken != null) return
        if (!worthHolding()) {
            session.disconnect()
            return
        }
        val token = nextToken++
        openToken = token
        if (!anchor.start(token)) {
            openToken = null
            session.disconnect()
            return
        }
        timer = scope.launch {
            delay(WINDOW_MILLIS)
            if (openToken != token || foreground) return@launch
            session.disconnect()
            openToken = null
            timer = null
            anchor.stop(token)
        }
    }

    fun onAnchorLost(token: Long) {
        if (openToken != token) return
        openToken = null
        timer?.cancel()
        timer = null
        if (foreground) return
        session.disconnect()
    }

    fun onAlwaysOnStarted() {
        val token = openToken ?: return
        openToken = null
        timer?.cancel()
        timer = null
        anchor.stop(token)
    }

    private fun worthHolding(): Boolean {
        val status = session.status.value
        if (status is Session.Status.Unauthorized) return false
        val restore = session.restoreState.value
        if (restore is Session.RestoreState.Pending) return true
        val unbound = restore is Session.RestoreState.Unpaired &&
            session.connection.value == null &&
            status is Session.Status.Unpaired
        return !unbound
    }

    companion object {
        const val WINDOW_MILLIS = 25_000L
    }
}

internal fun installSessionLinger(
    lifecycle: Lifecycle,
    session: Session,
    scope: CoroutineScope,
    anchor: SessionLingerController.ProcessAnchor,
    alwaysOn: () -> Boolean = { false },
): SessionLingerController {
    val controller = SessionLingerController(session, scope, anchor, alwaysOn)
    anchor.attach(controller)
    lifecycle.addObserver(controller)
    return controller
}
