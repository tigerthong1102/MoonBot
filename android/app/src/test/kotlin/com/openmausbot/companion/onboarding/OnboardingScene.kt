// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.onboarding

import android.Manifest
import android.app.Application
import android.content.Context
import com.openmausbot.companion.avatar.AvatarImageStore
import com.openmausbot.companion.core.APIError
import com.openmausbot.companion.core.CompanionClient
import com.openmausbot.companion.core.Connection
import com.openmausbot.companion.core.ConnectionStore
import com.openmausbot.companion.core.Fleet
import com.openmausbot.companion.core.PairResponse
import com.openmausbot.companion.core.PairedDevice
import com.openmausbot.companion.core.PairingOutcome
import com.openmausbot.companion.core.Session
import com.openmausbot.companion.core.StreamFrame
import com.openmausbot.companion.core.TokenStore
import com.openmausbot.companion.dictation.SpeechDictation
import com.openmausbot.companion.discovery.CompanionDiscovery
import com.openmausbot.companion.discovery.DiscoveryState
import com.openmausbot.companion.permissions.CompanionPermissions
import com.openmausbot.companion.sharing.ShareInbox
import com.openmausbot.companion.storage.ChatPreferences
import com.openmausbot.companion.storage.OnboardingPreferences
import com.openmausbot.companion.ui.CameraPermissionController
import com.openmausbot.companion.ui.ChatDraftHolder
import com.openmausbot.companion.ui.CompanionEnvironment
import com.openmausbot.companion.ui.MicPermissionController
import com.openmausbot.companion.ui.NotificationPermissionController
import com.openmausbot.companion.ui.PermissionPreferences
import com.openmausbot.companion.audio.VoicePreviewPlayer
import com.openmausbot.companion.audio.VoiceNotePlayer
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.awaitCancellation
import org.robolectric.RuntimeEnvironment


class OnboardingScene(

    val granted: MutableSet<String> = mutableSetOf(),
    sdkInt: Int = 34,
    notificationsEnabled: Boolean = false,
    canRequestNotifications: Boolean = true,
    shouldShowNotificationRationale: Boolean = true,
    hasAskedNotificationsBefore: Boolean = false,
    savedConnection: Connection? = null,
    savedToken: String? = null,

    private val revoked: Boolean = false,
    private val pairSuspendsUntil: kotlinx.coroutines.CompletableDeferred<Unit>? = null,
    notificationOnboardingPending: Boolean = false,
    welcomeSeen: Boolean = false,
    notificationPromptSeen: Boolean = false,
) {
    private val context: Context = RuntimeEnvironment.getApplication() as Application
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)


    val permissionRequests = mutableListOf<List<String>>()

    val discovery = FakeDiscovery()

    var notificationsAreEnabled = notificationsEnabled

    private val prefsName = "onboarding-scene-${SCENES.incrementAndGet()}"

    val onboarding = OnboardingPreferences(
        prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE),
        io = EmptyCoroutineContext,
    )

    val permissions = CompanionPermissions(sdkInt = sdkInt, granted = { it in granted })

    val notifications = NotificationPermissionController(
        isGranted = { notificationsAreEnabled },
        canRequest = { canRequestNotifications },
        shouldShowRationale = { shouldShowNotificationRationale },
        hasAskedBefore = { hasAskedNotificationsBefore },
        request = { record(listOf(PermissionPreferences.POST_NOTIFICATIONS)) },
        openSettings = { record(listOf("settings:notifications")) },
    )

    val session = Session(
        scope = scope,
        connectionStore = FakeConnectionStore(savedConnection),
        tokenStore = FakeTokenStore(savedConnection?.id, savedToken),
        onboardingStore = onboarding,
        deviceNameProvider = { "Pixel" },
        clientFactory = { c, token -> CompanionClient(c, token) },
        pairFn = { c, _, _, _ ->
            pairSuspendsUntil?.await()
            PairingOutcome(
                PairResponse(
                    token = "device-token",
                    device = PairedDevice("d1", "Pixel", 1.0, 1.0),
                    serverName = "Mac",
                ),
                c,
            )
        },
        eventsFn = { _, _, _ ->
            if (revoked) flow<StreamFrame> { throw APIError.Status(401, "revoked") } else emptyFlow()
        },
        hydrateFn = { _, _ -> Fleet(emptyList(), emptyList()) },
        metadataFn = { throw APIError.Status(404) },
    )

    val environment = CompanionEnvironment(
        session = session,
        permissions = permissions,
        discovery = discovery,
        onboarding = onboarding,
        chatPreferences = ChatPreferences(context),
        camera = CameraPermissionController(
            isGranted = { "android.permission.CAMERA" in granted },
            request = { record(listOf("android.permission.CAMERA")) },
        ),
        mic = MicPermissionController(
            isGranted = { Manifest.permission.RECORD_AUDIO in granted },
            request = { record(listOf(Manifest.permission.RECORD_AUDIO)) },
        ),
        notifications = notifications,
        avatars = AvatarImageStore(fetch = { null }),
        voicePreview = VoicePreviewPlayer(context),
        voiceNotes = VoiceNotePlayer(context),
        dictation = SpeechDictation(
            context = context,
            hasRecordAudio = { false },
            requestRecordAudio = { it(false) },
            preferredLanguages = { listOf("en-US") },
        ),
        chatDrafts = ChatDraftHolder(),
        requestPermissions = { permissions -> record(permissions.toList()) },
        openAppSettings = { record(listOf("settings:app")) },
        shareTranscript = { _, _ -> null },
        openCloudDesktop = { null },
        shareInbox = ShareInbox(),
        alwaysOnEnabled = MutableStateFlow(false),
        onToggleAlwaysOn = {},
    )

    init {
        runBlockingWrite {
            if (welcomeSeen) onboarding.setWelcomeSeen(true)
            if (notificationPromptSeen) onboarding.setNotificationPromptSeen(true)
            if (notificationOnboardingPending) {
                onboarding.setNotificationOnboardingPending(true)
            }
        }
    }

    private fun record(permissions: List<String>) {
        permissionRequests += permissions
    }

    fun asked(): List<String> = permissionRequests.flatten()

    fun relaunchedOnboarding() = OnboardingPreferences(
        prefs = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE),
        io = EmptyCoroutineContext,
    )

    private fun runBlockingWrite(block: suspend () -> Unit) =
        kotlinx.coroutines.runBlocking { block() }

    class FakeDiscovery : CompanionDiscovery {
        val starts = MutableStateFlow(0)
        val active = MutableStateFlow(0)

        override fun discover(): Flow<DiscoveryState> = flow {
            starts.value += 1
            active.value += 1
            try {
                emit(DiscoveryState.Active(browsing = true, found = emptyList()))
                awaitCancellation()
            } finally {
                active.value -= 1
            }
        }
    }

    private class FakeConnectionStore(private var saved: Connection?) : ConnectionStore {
        override suspend fun load(): Connection? = saved
        override suspend fun save(connection: Connection) {
            saved = connection
        }
        override suspend fun clear() {
            saved = null
        }
    }

    private class FakeTokenStore(id: String?, token: String?) : TokenStore {
        private val tokens = linkedMapOf<String, String>().apply {
            if (id != null && token != null) put(id, token)
        }
        override suspend fun save(connectionId: String, token: String) {
            tokens[connectionId] = token
        }
        override suspend fun read(connectionId: String): TokenStore.ReadResult =
            tokens[connectionId]?.let(TokenStore.ReadResult::Found)
                ?: TokenStore.ReadResult.Missing
        override suspend fun remove(connectionId: String) {
            tokens.remove(connectionId)
        }
    }

    companion object {
        private val SCENES = AtomicInteger(0)

        val MAC = Connection(id = "c1", name = "Mac", host = "127.0.0.1", port = 8810)
    }
}
