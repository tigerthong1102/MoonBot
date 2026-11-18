// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

/**
 * What counts as a pairing deep link.
 *
 * Recognised in exactly one place — `PairingLinkActivity`, the trampoline that
 * keeps the credential-carrying URL out of any Intent the system remembers.
 */
internal object PairingLink {
    const val SCHEME = "startupbot"
    const val HOST = "pair"

    fun isInvite(scheme: String?, host: String?): Boolean =
        (scheme.equals(SCHEME, ignoreCase = true) || scheme.equals("openmausbot", ignoreCase = true)) && host.equals(HOST, ignoreCase = true)
}

/** The Activity must be marked finishing before a pairing credential reaches an object that outlives it. */
internal object PairingHandoff {

    fun run(
        inviteUrl: String?,
        relaunch: () -> Unit,
        markFinishing: () -> Unit,
        deliver: (String) -> Unit,
    ) {
        relaunch()
        markFinishing()
        // 3. Only now does the credential enter process memory.
        if (inviteUrl != null) deliver(inviteUrl)
    }
}
