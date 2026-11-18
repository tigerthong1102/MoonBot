// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.lifecycle

import android.content.Context
import android.content.Intent
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.ProcessLifecycleOwner
import com.openmausbot.companion.OpenMausApp
import com.openmausbot.companion.core.InMemoryOnboardingStore
import com.openmausbot.companion.core.Session
import com.openmausbot.companion.core.TokenStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SessionLingerServiceTest {

    @After
    fun tearDown() {
        SessionLingerService.watch(null)
    }

    @Test
    fun `the service is not sticky and has no binder`() {
        val service = Robolectric.buildService(SessionLingerService::class.java).create().get()

        val intent = Intent(context, SessionLingerService::class.java)
            .putExtra(SessionLingerService.EXTRA_TOKEN, 7L)

        assertEquals(
            android.app.Service.START_NOT_STICKY,
            service.onStartCommand(intent, 0, 1),
        )
        assertNull(service.onBind(intent))
        // Never promoted: no notification of its own, no FGS type, no permission.
        assertNull(shadowOf(service).lastForegroundNotification)
    }

    @Test
    fun `a destroyed service reports its own token, once`() {
        val reported = mutableListOf<Long>()
        SessionLingerService.watch { token -> reported += token }

        val controller = Robolectric.buildService(SessionLingerService::class.java).create()
        val service = controller.get()
        service.onStartCommand(
            Intent(context, SessionLingerService::class.java)
                .putExtra(SessionLingerService.EXTRA_TOKEN, 42L),
            0,
            1,
        )

        controller.destroy()
        assertEquals(listOf(42L), reported)

        service.onDestroy()
        assertEquals(listOf(42L), reported)
    }

    @Test
    fun `a service started without a token reports nothing`() {
        val reported = mutableListOf<Long>()
        SessionLingerService.watch { token -> reported += token }

        val controller = Robolectric.buildService(SessionLingerService::class.java).create()
        controller.get().onStartCommand(Intent(context, SessionLingerService::class.java), 0, 1)
        controller.destroy()

        assertTrue(reported.isEmpty())
    }

    @Test
    fun `the anchor starts and stops that exact service, carrying the token`() {
        val anchor = ServiceProcessAnchor(context)

        assertTrue(anchor.start(9L))
        val started = appShadow.peekNextStartedService()
        assertEquals(
            SessionLingerService::class.java.name,
            started.component?.className,
        )
        assertEquals(9L, started.getLongExtra(SessionLingerService.EXTRA_TOKEN, 0L))

        anchor.stop(9L)
        assertEquals(
            SessionLingerService::class.java.name,
            appShadow.nextStoppedService.component?.className,
        )
    }

    @Test
    fun `attach routes a service the system destroys back to the coordinator`() {
        val scope = CoroutineScope(StandardTestDispatcher(TestCoroutineScheduler()))
        val session = Session(
            scope = scope,
            connectionStore = store(TEST_CONNECTION),
            tokenStore = tokens(TokenStore.ReadResult.Found("device-token")),
            onboardingStore = InMemoryOnboardingStore(),
            deviceNameProvider = { "Pixel" },
            eventsFn = { _, _, _ -> emptyFlow() },
        )
        val anchor = ServiceProcessAnchor(context)
        val controller = SessionLingerController(session, scope, anchor)
        anchor.attach(controller)

        controller.onStop(TestOwner())
        val startIntent = appShadow.peekNextStartedService()
        assertEquals(1L, controller.openWindow)
        assertEquals(1L, startIntent.getLongExtra(SessionLingerService.EXTRA_TOKEN, 0L))

        val service = Robolectric.buildService(SessionLingerService::class.java).create()
        service.get().onStartCommand(startIntent, 0, 1)
        service.destroy()

        assertNull(controller.openWindow)
        scope.cancel()
    }

    @Test
    fun `the Application registers the linger coordinator on the process lifecycle`() {
        val app = RuntimeEnvironment.getApplication() as OpenMausApp
        val registry = ProcessLifecycleOwner.get().lifecycle as LifecycleRegistry

        val before = registry.observerCount
        registry.removeObserver(app.linger)
        assertEquals(before - 1, registry.observerCount)
        registry.addObserver(app.linger)
    }

    private val context: Context get() = RuntimeEnvironment.getApplication()

    private val appShadow: org.robolectric.shadows.ShadowApplication
        get() = shadowOf(RuntimeEnvironment.getApplication())
}
