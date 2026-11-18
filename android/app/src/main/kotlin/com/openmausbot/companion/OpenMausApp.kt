// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion

import android.app.Application
import androidx.lifecycle.ProcessLifecycleOwner
import com.openmausbot.companion.audio.VoicePreviewPlayer
import com.openmausbot.companion.audio.VoiceNotePlayer
import com.openmausbot.companion.avatar.AvatarImageStore
import com.openmausbot.companion.core.Session
import com.openmausbot.companion.discovery.NsdDiscovery
import com.openmausbot.companion.lifecycle.AlwaysOnConnectionService
import com.openmausbot.companion.lifecycle.AlwaysOnConnectionState
import com.openmausbot.companion.lifecycle.ServiceProcessAnchor
import com.openmausbot.companion.lifecycle.SessionLingerController
import com.openmausbot.companion.lifecycle.installSessionLinger
import com.openmausbot.companion.notifications.LocalNotificationPoster
import com.openmausbot.companion.permissions.CompanionPermissions
import com.openmausbot.companion.sharing.ShareInbox
import com.openmausbot.companion.storage.AlwaysOnPreferences
import com.openmausbot.companion.storage.DataStoreConnectionStore
import com.openmausbot.companion.storage.OnboardingPreferences
import com.openmausbot.companion.storage.KeystoreTokenStore
import com.openmausbot.companion.ui.FilePreviews
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

class OpenMausApp : Application() {
    private val appJob = SupervisorJob()
    val appScope = CoroutineScope(appJob + Dispatchers.Main.immediate)

    lateinit var session: Session
        private set
    lateinit var notifications: LocalNotificationPoster
        private set
    lateinit var discovery: NsdDiscovery
        private set
    lateinit var permissions: CompanionPermissions
        private set

    lateinit var onboarding: OnboardingPreferences
        private set
    lateinit var avatars: AvatarImageStore
        private set
    lateinit var voicePreview: VoicePreviewPlayer
        private set
    lateinit var voiceNotes: VoiceNotePlayer
        private set
    lateinit var linger: SessionLingerController
        private set
    lateinit var shareInbox: ShareInbox
        private set
    lateinit var alwaysOn: AlwaysOnPreferences
        private set

    override fun onCreate() {
        super.onCreate()
        shareInbox = ShareInbox()
        ShareInbox.cleanStale(cacheDir)
        FilePreviews.startStaleCleanup(this, appScope)
        notifications = LocalNotificationPoster(this)
        discovery = NsdDiscovery(this)
        permissions = CompanionPermissions(this)
        onboarding = OnboardingPreferences(this)
        session = Session(
            scope = appScope,
            connectionStore = DataStoreConnectionStore(this),
            tokenStore = KeystoreTokenStore(this),
            onboardingStore = onboarding,
            deviceNameProvider = {
                // User-visible device name; Settings.Global.DEVICE_NAME on API 25+.
                android.provider.Settings.Global.getString(contentResolver, "device_name")
                    ?.takeIf { it.isNotBlank() }
                    ?: android.os.Build.MODEL
            },
            notificationSink = notifications,
        )
        avatars = AvatarImageStore(fetch = session::avatarData)
        voicePreview = VoicePreviewPlayer(this)
        voiceNotes = VoiceNotePlayer(this)

        appScope.launch {
            session.status
                .map { it is Session.Status.Unpaired }
                .distinctUntilChanged()
                .collect { unpaired ->
                    if (unpaired) avatars.clearBlocking()
                }
        }

        linger = installSessionLinger(
            lifecycle = ProcessLifecycleOwner.get().lifecycle,
            session = session,
            scope = appScope,
            anchor = ServiceProcessAnchor(this),
            alwaysOn = { AlwaysOnConnectionState.active },
        )

        alwaysOn = AlwaysOnPreferences(this)
        if (alwaysOn.enabled.value) {
            AlwaysOnConnectionService.start(this)
        }
    }
}
