// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.lifecycle

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.openmausbot.companion.storage.AlwaysOnPreferences

class AlwaysOnBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        if (AlwaysOnPreferences(context).enabled.value) {
            AlwaysOnConnectionService.start(context)
        }
    }
}
