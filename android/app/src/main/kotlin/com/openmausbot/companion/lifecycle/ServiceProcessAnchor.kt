// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.lifecycle

import android.content.Context
import android.content.Intent


class ServiceProcessAnchor(context: Context) : SessionLingerController.ProcessAnchor {
    private val appContext = context.applicationContext

    override fun attach(controller: SessionLingerController) {
        SessionLingerService.watch { token -> controller.onAnchorLost(token) }
    }

    override fun start(token: Long): Boolean = try {
        val intent = Intent(appContext, SessionLingerService::class.java)
            .putExtra(SessionLingerService.EXTRA_TOKEN, token)
        appContext.startService(intent) != null
    } catch (error: IllegalStateException) {
        // "Not allowed to start service ...: app is in background" (API 26+).
        false
    } catch (error: SecurityException) {
        false
    }

    override fun stop(token: Long) {
        try {
            appContext.stopService(Intent(appContext, SessionLingerService::class.java))
        } catch (error: IllegalStateException) {
        } catch (error: SecurityException) {
        }
    }
}
