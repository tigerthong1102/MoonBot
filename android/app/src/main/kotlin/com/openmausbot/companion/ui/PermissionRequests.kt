// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

/** Where the "we have asked" flag lives. Not a secret; not backed up either. */
internal object PermissionPreferences {
    const val NAME = "openmaus.permissions"

    /** The on-disk file, named here so the backup rules can be asserted against it. */
    const val FILE = "$NAME.xml"

    const val ASKED_NOTIFICATIONS = "askedNotifications"

    /**
     * Literal rather than `Manifest.permission.POST_NOTIFICATIONS` for the same
     * reason `CompanionPermissions` spells out its own: it keeps this readable
     * from a plain JVM test with no android.jar behaviour behind it.
     */
    const val POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS"

    /** Composer dictation mic — asked only from the mic button's flow. */
    const val RECORD_AUDIO = "android.permission.RECORD_AUDIO"
}

internal class PermissionRequests(
    private val markAsked: (String) -> Unit,
    private val launchMultiple: (Array<String>) -> Unit,
    private val launchSingle: (String) -> Unit,
    private val onNotificationResult: (Boolean) -> Unit,
    private val onRecordAudioResult: (Boolean) -> Unit = {},
    /**
     * Permissions whose "already asked" state has to outlive the process.
     * RECORD_AUDIO joins notifications so a permanent denial through the mic
     * button cannot be misread as "never asked" after a recreation.
     */
    private val tracked: Set<String> = setOf(
        PermissionPreferences.POST_NOTIFICATIONS,
        PermissionPreferences.RECORD_AUDIO,
    ),
) {
    /** The root's first-entry request for everything still missing. */
    fun request(permissions: Array<String>) {
        if (permissions.isEmpty()) return
        permissions.filter { it in tracked }.forEach(markAsked)
        launchMultiple(permissions)
    }

    /** The Settings row's request for one permission, or the composer mic. */
    fun request(permission: String) {
        if (permission in tracked) markAsked(permission)
        launchSingle(permission)
    }

    /** Results from either launcher, routed to whoever is showing that state. */
    fun onResults(results: Map<String, Boolean>) {
        results[PermissionPreferences.POST_NOTIFICATIONS]?.let(onNotificationResult)
        results[PermissionPreferences.RECORD_AUDIO]?.let(onRecordAudioResult)
    }
}
