// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import com.openmausbot.companion.audio.VoicePreviewPlayer
import com.openmausbot.companion.audio.VoiceNotePlayer
import com.openmausbot.companion.avatar.AvatarImageStore
import com.openmausbot.companion.core.ExportedTranscript
import com.openmausbot.companion.core.Session
import com.openmausbot.companion.dictation.SpeechDictation
import java.net.URI
import com.openmausbot.companion.discovery.CompanionDiscovery
import com.openmausbot.companion.permissions.CompanionPermissions
import com.openmausbot.companion.sharing.ShareInbox
import com.openmausbot.companion.storage.OnboardingPreferences
import com.openmausbot.companion.storage.ChatPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class CameraAccess { UNKNOWN, GRANTED, DENIED }

/**
 * Camera permission is asked for at the moment the user opens the scanner and
 * never before — the app is usable without a camera (Bonjour list, typed
 * address), so a launch-time prompt would be asking for something most sessions
 * never use.
 */
class CameraPermissionController(
    private val isGranted: () -> Boolean,
    private val request: () -> Unit,
) {
    private val _access = MutableStateFlow(if (isGranted()) CameraAccess.GRANTED else CameraAccess.UNKNOWN)
    val access: StateFlow<CameraAccess> = _access.asStateFlow()

    fun ensure() {
        if (isGranted()) {
            _access.value = CameraAccess.GRANTED
            return
        }
        request()
    }

    fun onResult(granted: Boolean) {
        _access.value = if (granted) CameraAccess.GRANTED else CameraAccess.DENIED
    }

    fun refresh() {
        if (isGranted()) _access.value = CameraAccess.GRANTED
    }
}

/**
 * Microphone permission for composer dictation. Asked only from the mic button,
 * through [PermissionRequests] so the asked-flag has a single owner. Callers
 * pass a result callback; a stop that races the system sheet is discarded by
 * [SpeechDictation]'s generation guard, not by dropping this callback.
 */
class MicPermissionController(
    private val isGranted: () -> Boolean,
    private val request: () -> Unit,
) {
    private var pending: ((Boolean) -> Unit)? = null

    fun ensure(onResult: (Boolean) -> Unit) {
        if (isGranted()) {
            onResult(true)
            return
        }
        pending = onResult
        request()
    }

    fun onResult(granted: Boolean) {
        val callback = pending
        pending = null
        callback?.invoke(granted)
    }

    fun refresh() {
        // No published state — SpeechDictation re-checks grant on each start.
        if (isGranted()) {
            val callback = pending
            pending = null
            callback?.invoke(true)
        }
    }
}

@Immutable
class CompanionEnvironment(
    val session: Session,
    val permissions: CompanionPermissions,
    val discovery: CompanionDiscovery,
    val onboarding: OnboardingPreferences,
    val chatPreferences: ChatPreferences,
    val camera: CameraPermissionController,
    val mic: MicPermissionController,
    val notifications: NotificationPermissionController,
    val avatars: AvatarImageStore,
    val voicePreview: VoicePreviewPlayer,
    val voiceNotes: VoiceNotePlayer,
    val dictation: SpeechDictation,
    val chatDrafts: ChatDraftHolder,
    val requestPermissions: (Array<String>) -> Unit,
    /** Opens the OS app-settings page, for a permission the user denied. */
    val openAppSettings: () -> Unit,
    val shareTranscript: (ExportedTranscript, ShareFormat) -> String?,
    val openCloudDesktop: (URI) -> String?,
    val shareInbox: ShareInbox,
    val alwaysOnEnabled: StateFlow<Boolean>,
    val onToggleAlwaysOn: () -> Unit,
)

val LocalCompanion = staticCompositionLocalOf<CompanionEnvironment> {
    error("CompanionEnvironment was not provided")
}
