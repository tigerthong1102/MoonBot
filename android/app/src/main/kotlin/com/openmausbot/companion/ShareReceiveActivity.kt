// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.openmausbot.companion.sharing.ShareHandoff
import com.openmausbot.companion.sharing.ShareInbox
import com.openmausbot.companion.sharing.ShareItemLoader
import com.openmausbot.companion.sharing.SharePayload
import com.openmausbot.companion.ui.ShareLoadException
import com.openmausbot.companion.ui.SharePolicy
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** Inbound content URIs must be read only under the sender's temporary grant; credentials must not enter persisted task state. */
class ShareReceiveActivity : Activity() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as OpenMausApp
        scope.launch {
            ShareHandoff.run(
                copy = {
                    try {
                        SharePayload.Ready(
                            ShareItemLoader.load(intent, contentResolver, ShareInbox.root(cacheDir)),
                        )
                    } catch (error: Exception) {
                        SharePayload.Failed(
                            (error as? ShareLoadException)?.message ?: SharePolicy.generic(),
                        )
                    }
                },
                relaunch = {
                    startActivity(
                        Intent(this@ShareReceiveActivity, MainActivity::class.java).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                        },
                    )
                },
                markFinishing = ::finish,
                deliver = app.shareInbox::offer,
            )
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
