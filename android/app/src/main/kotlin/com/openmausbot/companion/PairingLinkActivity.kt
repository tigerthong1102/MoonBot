// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.openmausbot.companion.ui.PairingHandoff
import com.openmausbot.companion.ui.PairingLink

/** Android retains Activity launch intents in task records. Pairing credentials must not be persisted there. */
class PairingLinkActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val data = intent?.data
        val inviteUrl = data
            ?.takeIf { PairingLink.isInvite(it.scheme, it.host) }
            ?.toString()




        PairingHandoff.run(
            inviteUrl = inviteUrl,
            relaunch = {




                startActivity(
                    Intent(this, MainActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    },
                )
            },
            markFinishing = ::finish,
            deliver = { url -> (application as OpenMausApp).session.receivePairingURL(url) },
        )
    }
}
