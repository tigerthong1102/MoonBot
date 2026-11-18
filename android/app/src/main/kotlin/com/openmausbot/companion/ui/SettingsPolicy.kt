// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import com.openmausbot.companion.core.Connection
import com.openmausbot.companion.core.Session
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

object SettingsPolicy {
    const val NOTIFICATIONS_FOOTER =
        "Approvals and finished work appear while StartupBot is connected, including " +
            "frames replayed after a short background pause. Closed-app push needs a " +
            "separate push-relay release that does not exist yet."

    const val WORKSPACE_FOOTER =
        "Routine schedules are safe to manage here. Provider keys, webhook secrets, " +
            "pairing, revocation, Local VM, and agent execution policy stay on your computer."

    const val UNPAIR_FOOTER =
        "Removes the pairing from this phone only. To stop it reaching the computer at all, " +
            "remove the device in StartupBot → Settings → Phone."

    const val NOT_HERE =
        "API keys, pairing and the Local VM are managed on the computer. This phone is " +
            "deliberately not allowed to change them."

    const val UNPAIR_CONFIRM_TITLE = "Unpair this phone?"
    const val UNPAIR_CONFIRM_MESSAGE = "You'll need a new pairing code to connect again."

    const val EDIT_ADDRESS_MESSAGE =
        "Enter whatever Phone settings on your computer shows. The pairing itself is kept."

    fun statusText(status: Session.Status): String = when (status) {
        Session.Status.Live -> "Connected"
        Session.Status.Connecting -> "Connecting…"
        Session.Status.Unpaired -> "Not paired"
        Session.Status.Unauthorized -> "Unpaired on the computer"
        is Session.Status.Offline -> status.message
    }

    fun addressText(connection: Connection?): String =
        connection?.displayAddress ?: "—"
}

object AddressEdit {
    const val INVALID =
        "Enter a secure https:// address, 192.168.1.42:8810, or a name like " +
            "macbook.tail1234.ts.net."

    fun isValid(text: String): Boolean = Connection.parse(text) != null
}

enum class NotificationAccess {
    GRANTED,

    ASKABLE,

    BLOCKED,
}

/**
 * The notification permission, as a row with one button.
 *
 * Two platform facts shape this, and getting either wrong shows the user a button
 * that does nothing:
 *
 * - **Being granted the runtime permission is not the same as notifications being
 *   on.** Below API 33 there is no runtime permission at all, yet a person can
 *   still switch the app's notifications off in system settings; on 33+ they can
 *   do it after granting. `areNotificationsEnabled()` is the question that
 *   actually matters on every version, so that is what [isGranted] asks.
 * - **"Denied for good" is not directly observable.** After a refusal
 *   `shouldShowRequestPermissionRationale` stays true while the OS is still
 *   willing to prompt and goes false once it is not — but it is *also* false
 *   before the first request. The two are told apart by [hasAskedBefore], which
 *   outlives the Activity and the process, so a recreation does not turn a dead
 *   request back into a live-looking button. `PermissionRequests` sets that flag
 *   as part of launching any prompt, so every path that can ask is covered — not
 *   only the one this class starts.
 *
 * Where no request can help — pre-33, or a permanent denial — the button routes
 * to the app's notification settings instead.
 */
class NotificationPermissionController(
    private val isGranted: () -> Boolean,
    /** False below API 33, where there is no runtime permission to ask for. */
    private val canRequest: () -> Boolean,
    private val shouldShowRationale: () -> Boolean,
    private val hasAskedBefore: () -> Boolean,
    private val request: () -> Unit,
    private val openSettings: () -> Unit,
) {
    private val _access = MutableStateFlow(read())
    val access: StateFlow<NotificationAccess> = _access.asStateFlow()

    fun act() {
        val current = read()
        _access.value = current
        when (current) {
            NotificationAccess.GRANTED -> Unit
            NotificationAccess.BLOCKED -> openSettings()
            NotificationAccess.ASKABLE -> request()
        }
    }

    fun onResult(granted: Boolean) {
        _access.value = read(grantedOverride = granted)
    }

    fun refresh() {
        _access.value = read()
    }

    private fun read(grantedOverride: Boolean? = null): NotificationAccess {
        val granted = grantedOverride?.let { it && isGranted() } ?: isGranted()
        return when {
            granted -> NotificationAccess.GRANTED
            !canRequest() -> NotificationAccess.BLOCKED
            shouldShowRationale() -> NotificationAccess.ASKABLE
            hasAskedBefore() -> NotificationAccess.BLOCKED
            else -> NotificationAccess.ASKABLE
        }
    }

    companion object {
        fun statusText(access: NotificationAccess): String = when (access) {
            NotificationAccess.GRANTED -> "Allowed"
            NotificationAccess.ASKABLE -> "Not allowed"
            NotificationAccess.BLOCKED -> "Turned off in system settings"
        }

        fun buttonText(access: NotificationAccess): String = when (access) {
            NotificationAccess.GRANTED -> "Notifications are on"
            NotificationAccess.ASKABLE -> "Enable notifications"
            NotificationAccess.BLOCKED -> "Open notification settings"
        }

        fun buttonEnabled(access: NotificationAccess): Boolean =
            access != NotificationAccess.GRANTED
    }
}
