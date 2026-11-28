// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.onboarding

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.openmausbot.companion.core.NotificationAuthorizationState
import com.openmausbot.companion.core.OnboardingPairingState
import com.openmausbot.companion.core.Session
import com.openmausbot.companion.ui.CompanionRoot
import com.openmausbot.companion.ui.LocalCompanion
import com.openmausbot.companion.ui.NotificationAccess
import com.openmausbot.companion.ui.notificationAuthorization
import com.openmausbot.companion.ui.onboardingPairingState
import com.openmausbot.companion.ui.OnboardingCopy
import com.openmausbot.companion.ui.PermissionPreferences
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config


@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class OnboardingRoutingTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun mount(scene: OnboardingScene) {
        compose.setContent {
            CompositionLocalProvider(LocalCompanion provides scene.environment) {
                CompanionRoot(pendingNotification = null, onPendingTargetConsumed = {})
            }
        }
        compose.waitUntil(5_000) {
            scene.session.restoreState.value !is Session.RestoreState.Pending
        }
        compose.waitForIdle()
    }

    @Test
    @Config(qualifiers = "vi-rVN")
    fun `Vietnamese welcome and unpaired home follow the device locale`() {
        mount(OnboardingScene())
        compose.onNodeWithText("Chào mừng bạn đến với StartupBot").assertIsDisplayed()
        val mobileEntry = compose.onNodeWithText("Chat không cần máy tính")
        if (compose.activity.getString(com.openmausbot.companion.R.string.startupbot_mobile_origin).isEmpty()) {
            mobileEntry.assertDoesNotExist()
        } else {
            mobileEntry.assertIsDisplayed()
            val pairing = compose.onNodeWithText("Kết nối với máy tính của tôi")
            org.junit.Assert.assertTrue(mobileEntry.fetchSemanticsNode().boundsInRoot.center.y < pairing.fetchSemanticsNode().boundsInRoot.center.y)
            mobileEntry.performClick()
            val target = org.robolectric.Shadows.shadowOf(compose.activity).nextStartedActivity.data
            assertEquals("/mobile", target?.path)
            assertEquals("https", target?.scheme)
        }
        compose.onNodeWithText("Kết nối với máy tính của tôi").assertIsDisplayed()
        compose.onNodeWithText("Để sau").performClick()
        compose.onNodeWithText("Kết nối máy tính").assertIsDisplayed()
    }

    @Test
    fun `a first launch says what the app is before it asks the system for anything`() {
        val scene = OnboardingScene()
        mount(scene)

        compose.onNodeWithText(OnboardingCopy.WELCOME_TITLE).assertIsDisplayed()
        assertEquals(
            emptyList(),
            scene.asked(),
            "the first frame of a first launch put a system dialog on screen",
        )
        assertEquals(0, scene.discovery.starts.value, "and it started a network search")
    }

    @Test
    fun `Not now leads to a home that can still connect and still reach Settings`() {
        val scene = OnboardingScene()
        mount(scene)

        compose.onNodeWithText(OnboardingCopy.NOT_NOW).performClick()
        compose.waitForIdle()

        compose.onNodeWithText(OnboardingCopy.UNPAIRED_HOME_TITLE).assertIsDisplayed()
        compose.onNodeWithText(OnboardingCopy.UNPAIRED_HOME_CONNECT).assertIsDisplayed()

        compose.onNodeWithContentDescription("Settings").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Connect a computer").assertIsDisplayed()
        compose.onNodeWithText("Enable notifications").assertIsDisplayed()
        compose.onNodeWithText("Unpair this phone").assertDoesNotExist()
        compose.onNodeWithText("Tasks & Routines").assertDoesNotExist()

        assertEquals(emptyList(), scene.asked(), "declining setup still spent a prompt")

        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
        compose.onNodeWithText(OnboardingCopy.UNPAIRED_HOME_TITLE).assertIsDisplayed()
    }

    @Test
    fun `the unpaired home leads back into pairing`() {
        val scene = OnboardingScene(welcomeSeen = true)
        mount(scene)

        compose.onNodeWithText(OnboardingCopy.UNPAIRED_HOME_TITLE).assertIsDisplayed()
        compose.onNodeWithText(OnboardingCopy.UNPAIRED_HOME_CONNECT).performClick()
        compose.waitForIdle()

        compose.onNodeWithText("Pair with a computer").assertIsDisplayed()
        assertEquals(emptyList(), scene.asked(), "reaching the QR screen asked for something")
    }

    @Test
    fun `a deep link opens pairing even on a first launch nobody has answered`() {
        val scene = OnboardingScene()
        mount(scene)
        compose.onNodeWithText(OnboardingCopy.WELCOME_TITLE).assertIsDisplayed()

        scene.session.receivePairingURL(
            "openmausbot://pair?address=127.0.0.1:8810&code=123456",
        )
        compose.waitForIdle()

        compose.onNodeWithText("Pair with a computer").assertIsDisplayed()
    }

    @Test
    fun `a pairing that already existed is never given first-pair education`() {
        val scene = OnboardingScene(
            savedConnection = OnboardingScene.MAC,
            savedToken = "device-token",
            welcomeSeen = true,
            notificationOnboardingPending = false,
        )
        mount(scene)

        compose.onNodeWithText("No bots yet").assertIsDisplayed()
        assertEquals(
            emptyList(),
            scene.asked(),
            "an upgrade asked an already-paired phone for a permission it never offered to explain",
        )
    }

    @Test
    fun `a first pairing explains notifications before the system dialog, and asks once`() {
        val scene = OnboardingScene(
            savedConnection = OnboardingScene.MAC,
            savedToken = "device-token",
            welcomeSeen = true,
            notificationOnboardingPending = true,
        )
        mount(scene)

        compose.onNodeWithText(OnboardingCopy.NOTIFICATIONS_TITLE).assertIsDisplayed()
        compose.onNodeWithText(OnboardingCopy.NOTIFICATIONS_BODY).assertIsDisplayed()
        assertEquals(
            emptyList(),
            scene.asked(),
            "the system dialog beat the explanation to the screen",
        )

        compose.onNodeWithText(OnboardingCopy.NOTIFICATIONS_ENABLE).performClick()
        compose.waitForIdle()

        assertEquals(
            listOf(PermissionPreferences.POST_NOTIFICATIONS),
            scene.asked(),
            "the explained step must ask for notifications and nothing else",
        )
        compose.onNodeWithText("No bots yet").assertIsDisplayed()
        assertFalse(
            scene.relaunchedOnboarding().notificationPending.value,
            "the prompt was fired but the marker is still pending",
        )
    }

    @Test
    fun `Not now on the education step ends it without a prompt`() {
        val scene = OnboardingScene(
            savedConnection = OnboardingScene.MAC,
            savedToken = "device-token",
            welcomeSeen = true,
            notificationOnboardingPending = true,
        )
        mount(scene)
        compose.onNodeWithText(OnboardingCopy.NOTIFICATIONS_TITLE).assertIsDisplayed()

        compose.onNodeWithText(OnboardingCopy.NOT_NOW).performClick()
        compose.waitForIdle()

        compose.onNodeWithText("No bots yet").assertIsDisplayed()
        assertEquals(emptyList(), scene.asked(), "\"Not now\" fired the prompt anyway")
        assertFalse(
            scene.relaunchedOnboarding().notificationPending.value,
            "the education step was answered but the marker is still pending",
        )
    }

    @Test
    fun `a phone whose notifications are already decided skips the step`() {
        val scene = OnboardingScene(
            savedConnection = OnboardingScene.MAC,
            savedToken = "device-token",
            welcomeSeen = true,
            notificationOnboardingPending = true,
            notificationsEnabled = true,
        )
        mount(scene)

        compose.onNodeWithText("No bots yet").assertIsDisplayed()
        assertEquals(emptyList(), scene.asked())
    }

    @Test
    fun `an upgrade that unpairs lands on the home, not on a welcome it never needed`() {
        val scene = OnboardingScene(
            savedConnection = OnboardingScene.MAC,
            savedToken = "device-token",
            welcomeSeen = false,
        )
        mount(scene)
        compose.onNodeWithText("No bots yet").assertIsDisplayed()

        scene.session.signOut()
        compose.waitUntil(5_000) { scene.session.connection.value == null }
        compose.waitForIdle()

        compose.onNodeWithText(OnboardingCopy.UNPAIRED_HOME_TITLE).assertIsDisplayed()
        compose.onNodeWithText(OnboardingCopy.WELCOME_TITLE).assertDoesNotExist()
    }

    @Test
    fun `a whole first run, from the welcome to a later unpair`() {
        val scene = OnboardingScene()
        mount(scene)
        compose.onNodeWithText(OnboardingCopy.WELCOME_TITLE).assertIsDisplayed()

        scene.session.receivePairingURL(
            "openmausbot://pair?address=127.0.0.1:8810&code=123456",
        )
        compose.waitUntil(5_000) { scene.session.pairingInvite.value != null }
        compose.waitForIdle()
        compose.onNodeWithText("Pair with this computer").performClick()
        compose.waitUntil(5_000) { scene.session.connection.value != null }
        compose.waitForIdle()

        compose.onNodeWithText(OnboardingCopy.NOTIFICATIONS_TITLE).assertIsDisplayed()
        assertEquals(
            emptyList(),
            scene.asked(),
            "a permission dialog reached the screen before the explanation did",
        )

        compose.onNodeWithText(OnboardingCopy.NOT_NOW).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("No bots yet").assertIsDisplayed()

        scene.session.signOut()
        compose.waitUntil(5_000) { scene.session.connection.value == null }
        compose.waitForIdle()

        compose.onNodeWithText(OnboardingCopy.UNPAIRED_HOME_TITLE).assertIsDisplayed()
        compose.onNodeWithText("Pair with a computer").assertDoesNotExist()
        assertFalse(
            scene.relaunchedOnboarding().notificationPending.value,
            "the unpaired phone still owes an education step for a pairing it no longer has",
        )
    }


    @Test
    fun `a revoked token outranks the connection record still sitting on disk`() {
        assertEquals(
            OnboardingPairingState.REVOKED,
            onboardingPairingState(Session.Status.Unauthorized, OnboardingScene.MAC),
        )
        assertEquals(
            OnboardingPairingState.PAIRED,
            onboardingPairingState(Session.Status.Offline("nope"), OnboardingScene.MAC),
        )
        assertEquals(
            OnboardingPairingState.UNPAIRED,
            onboardingPairingState(Session.Status.Unpaired, null),
        )
        assertEquals(
            OnboardingPairingState.UNPAIRED,
            onboardingPairingState(Session.Status.Connecting, null),
        )
    }

    @Test
    fun `a blocked notification permission counts as decided`() {
        assertEquals(
            NotificationAuthorizationState.NOT_DETERMINED,
            notificationAuthorization(NotificationAccess.ASKABLE),
        )
        assertEquals(
            NotificationAuthorizationState.DETERMINED,
            notificationAuthorization(NotificationAccess.GRANTED),
        )
        assertEquals(
            NotificationAuthorizationState.DETERMINED,
            notificationAuthorization(NotificationAccess.BLOCKED),
        )
    }


    @Test
    fun `a phone with nothing left to ask is not shown the step`() {
        val scene = OnboardingScene(
            savedConnection = OnboardingScene.MAC,
            savedToken = "device-token",
            welcomeSeen = true,
            notificationOnboardingPending = true,
            canRequestNotifications = false,
        )
        mount(scene)

        compose.onNodeWithText("No bots yet").assertIsDisplayed()
        compose.onNodeWithText(OnboardingCopy.NOTIFICATIONS_TITLE).assertDoesNotExist()
        assertEquals(emptyList(), scene.asked())
    }


    @Test
    fun `a deep link arriving at a revoked phone leaves recovery standing`() {
        val scene = OnboardingScene(
            savedConnection = OnboardingScene.MAC,
            savedToken = "device-token",
            welcomeSeen = true,
            notificationOnboardingPending = true,
            revoked = true,
        )
        mount(scene)
        scene.session.connect()
        compose.waitUntil(5_000) {
            scene.session.status.value is Session.Status.Unauthorized
        }
        compose.waitForIdle()



        compose.onNodeWithText("This phone was unpaired").assertIsDisplayed()

        scene.session.receivePairingURL(
            "openmausbot://pair?address=127.0.0.1:8810&code=123456",
        )
        compose.waitForIdle()

        assertNotNull(scene.session.pairingInvite.value)
        compose.onNodeWithText("This phone was unpaired").assertIsDisplayed()
        assertTrue(scene.asked().isEmpty())
    }
}
