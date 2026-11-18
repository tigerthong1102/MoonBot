// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.lifecycle

import androidx.lifecycle.Lifecycle
import com.openmausbot.companion.audio.PreviewAudioEngine
import com.openmausbot.companion.audio.PreviewAudioFocus
import com.openmausbot.companion.audio.VoicePreviewController
import com.openmausbot.companion.audio.VoicePreviewPlayer
import com.openmausbot.companion.avatar.AvatarImageStore
import com.openmausbot.companion.core.APIError
import com.openmausbot.companion.core.Fleet
import com.openmausbot.companion.core.Frame
import com.openmausbot.companion.core.Message
import com.openmausbot.companion.core.RuntimeEvent
import com.openmausbot.companion.core.Session
import com.openmausbot.companion.core.StreamFrame
import com.openmausbot.companion.core.TokenStore
import com.openmausbot.companion.notifications.NotificationMapping
import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest

@OptIn(ExperimentalCoroutinesApi::class)
class SessionLingerTest {


    @Test
    fun `a done notify ten seconds after Home still reaches the sink`() =
        assertNotifyLandsInBackground(kind = "done", channel = NotificationMapping.CHANNEL_DONE)

    @Test
    fun `a routine-failed notify in the background still reaches the sink`() =
        assertNotifyLandsInBackground(
            kind = "routine-failed",
            channel = NotificationMapping.CHANNEL_ROUTINE_FAILED,
        )

    @Test
    fun `an approval notify in the background still reaches the sink`() =
        assertNotifyLandsInBackground(
            kind = "approval",
            channel = NotificationMapping.CHANNEL_BLOCKING,
        )

    private fun assertNotifyLandsInBackground(kind: String, channel: String) = runTest {
        val stream = FakeStream()
        val sink = RecordingSink()
        val session = session(stream, sink, hydrate = { Fleet(listOf(bot()), emptyList()) })
        val owner = live(session, stream)

        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        advanceTimeBy(10_000)
        runCurrent()

        stream.emit(notify(kind, seq = 7))
        runCurrent()

        assertEquals(1, sink.delivered.size)
        val (frame, seq) = sink.delivered.single()
        assertEquals(kind, frame.kind)
        assertEquals(7, seq)
        assertEquals(channel, NotificationMapping.channelId(frame))
        assertEquals(listOf(frame), session.state.value.notifications)
        assertEquals("s:7", session.state.value.cursor)
        // One SSE connection throughout — not a reconnect that happened to
        // catch the frame.
        assertEquals(1, stream.opens)
        assertEquals(1, stream.collectors)
    }


    @Test
    fun `the stream survives to 24999ms and is cancelled at 25000ms`() = runTest {
        val stream = FakeStream()
        val sink = RecordingSink()
        val session = session(stream, sink)
        val owner = live(session, stream)

        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        advanceTimeBy(24_999)
        runCurrent()
        assertEquals(1, stream.collectors)
        assertEquals(listOf(1L), currentAnchor.started)

        advanceTimeBy(1)
        runCurrent()
        assertEquals(0, stream.collectors)
        assertEquals(listOf(1L), currentAnchor.stopped)
        assertNull(currentAnchor.held)

        stream.emit(notify("done", seq = 9))
        runCurrent()
        assertEquals(0, sink.delivered.size)
        assertEquals(1, stream.opens)
    }


    @Test
    fun `coming back after one second keeps the same connection`() =
        assertReturnKeepsConnection(afterMillis = 1_000)

    @Test
    fun `coming back after twenty-four seconds keeps the same connection`() =
        assertReturnKeepsConnection(afterMillis = 24_000)

    private fun assertReturnKeepsConnection(afterMillis: Long) = runTest {
        val stream = FakeStream()
        val sink = RecordingSink()
        val session = session(stream, sink)
        val owner = live(session, stream)

        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        advanceTimeBy(afterMillis)
        runCurrent()
        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_START)
        runCurrent()

        advanceTimeBy(60_000)
        runCurrent()
        stream.emit(notify("done", seq = 11))
        runCurrent()

        assertEquals(1, sink.delivered.size)
        assertEquals(11, sink.delivered.single().second)
        assertEquals(1, stream.opens)
        assertEquals(1, stream.collectors)
        assertEquals(listOf(1L), currentAnchor.started)
        assertEquals(listOf(1L), currentAnchor.stopped)
        assertNull(currentController.openWindow)
    }


    @Test
    fun `coming back after twenty-six seconds opens exactly one stream from the cursor`() = runTest {
        val stream = FakeStream()
        val sink = RecordingSink()
        val session = session(stream, sink)
        val owner = live(session, stream)

        stream.emit(notify("done", seq = 7))
        runCurrent()
        assertEquals("s:7", session.state.value.cursor)

        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        advanceTimeBy(25_000)
        runCurrent()
        assertEquals(0, stream.collectors)

        advanceTimeBy(1_000)
        runCurrent()
        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_START)
        runCurrent()

        assertEquals(2, stream.opens)
        assertEquals(listOf(null, "s:7"), stream.since)
        assertEquals(1, stream.collectors)
    }


    @Test
    fun `a second trip to the background gets its own full window`() = runTest {
        val stream = FakeStream()
        val sink = RecordingSink()
        val session = session(stream, sink)
        val owner = live(session, stream)

        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        advanceTimeBy(1_000)
        runCurrent()
        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_START)
        runCurrent()
        advanceTimeBy(1_000)
        runCurrent()
        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        runCurrent()

        advanceTimeBy(23_000)
        runCurrent()
        assertEquals(1, stream.collectors)
        stream.emit(notify("done", seq = 21))
        runCurrent()
        assertEquals(1, sink.delivered.size)
        assertEquals(21, sink.delivered.single().second)

        advanceTimeBy(2_000)
        runCurrent()
        assertEquals(0, stream.collectors)
        assertEquals(listOf(1L, 2L), currentAnchor.started)
        assertEquals(listOf(1L, 2L), currentAnchor.stopped)
        assertEquals(1, stream.opens)
    }

    @Test
    fun `a late onDestroy from the first trip cannot close the second window`() = runTest {
        val stream = FakeStream()
        val sink = RecordingSink()
        val session = session(stream, sink)
        val owner = live(session, stream, anchor = FakeAnchor(deferDestroy = true))

        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        advanceTimeBy(1_000)
        runCurrent()
        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_START)
        runCurrent()
        advanceTimeBy(1_000)
        runCurrent()
        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        runCurrent()
        advanceTimeBy(5_000)
        runCurrent()
        assertEquals(2L, currentController.openWindow)

        currentAnchor.deliverPendingDestroys()
        runCurrent()

        assertEquals(2L, currentController.openWindow)
        assertEquals(1, stream.collectors)
        stream.emit(notify("done", seq = 41))
        runCurrent()
        assertEquals(1, sink.delivered.size)
        assertEquals(41, sink.delivered.single().second)

        advanceTimeBy(19_999)
        runCurrent()
        assertEquals(1, stream.collectors)
        advanceTimeBy(1)
        runCurrent()
        assertEquals(0, stream.collectors)
        assertEquals(listOf(1L, 2L), currentAnchor.started)
        assertEquals(listOf(1L, 2L), currentAnchor.stopped)
        assertEquals(1, stream.opens)
    }


    @Test
    fun `an anchor the system reclaims ends the window at once`() = runTest {
        val stream = FakeStream()
        val sink = RecordingSink()
        val session = session(stream, sink)
        val owner = live(session, stream)

        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        advanceTimeBy(5_000)
        runCurrent()
        assertEquals(1, stream.collectors)

        currentAnchor.destroyedBySystem()
        runCurrent()
        assertEquals(0, stream.collectors)
        assertNull(currentController.openWindow)

        advanceTimeBy(30_000)
        runCurrent()
        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_START)
        runCurrent()
        assertEquals(2, stream.opens)
        assertEquals(1, stream.collectors)
        stream.emit(notify("done", seq = 31))
        runCurrent()
        assertEquals(1, sink.delivered.size)
    }

    @Test
    fun `an anchor that refuses to start disconnects immediately`() = runTest {
        val stream = FakeStream()
        val sink = RecordingSink()
        val session = session(stream, sink)
        val owner = live(session, stream, anchor = FakeAnchor(refuseStart = true))

        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        runCurrent()

        assertEquals(0, stream.collectors)
        assertEquals(1, currentAnchor.startAttempts)
        assertTrue(currentAnchor.started.isEmpty())
        assertNull(currentController.openWindow)
    }


    @Test
    fun `always-on starting after ON_STOP cancels the window without disconnecting`() = runTest {
        val stream = FakeStream()
        val sink = RecordingSink()
        val session = session(stream, sink)
        val owner = live(session, stream)

        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        runCurrent()
        assertEquals(1, stream.collectors)
        assertEquals(listOf(1L), currentAnchor.started)

        currentController.onAlwaysOnStarted()
        assertEquals(listOf(1L), currentAnchor.stopped)
        assertNull(currentController.openWindow)

        advanceTimeBy(30_000)
        runCurrent()
        assertEquals(1, stream.collectors)
        stream.emit(notify("done", seq = 50))
        runCurrent()
        assertEquals(1, sink.delivered.size)
    }


    @Test
    fun `a turn that finishes in the background lands transcript, cursor and notify`() = runTest {
        val stream = FakeStream()
        val sink = RecordingSink()
        val session = session(stream, sink, hydrate = { Fleet(listOf(bot()), emptyList()) })
        val owner = live(session, stream)

        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        advanceTimeBy(2_000)
        runCurrent()

        stream.emit(delta("t1", "The report", seq = 4))
        stream.emit(delta("t1", " is ready.", seq = 5))
        runCurrent()
        assertEquals("The report is ready.", session.state.value.streaming["t1"])

        stream.emit(
            StreamFrame(
                Frame.Message(
                    "t1",
                    Message(
                        id = "m9",
                        role = Message.Role.BOT,
                        kind = Message.Kind.TEXT,
                        at = 1.0,
                        text = "The report is ready.",
                    ),
                ),
                seq = 6,
            ),
        )
        stream.emit(StreamFrame(Frame.Runtime(RuntimeEvent("turn.completed", "t1")), seq = 7))
        stream.emit(notify("done", seq = 8))
        runCurrent()

        assertEquals(
            listOf("The report is ready."),
            session.state.value.transcript("t1").map { it.text },
        )
        assertNull(session.state.value.streaming["t1"])
        assertEquals(1, sink.delivered.size)
        assertEquals(8, sink.delivered.single().second)
        assertEquals("s:8", session.state.value.cursor)
        assertEquals(1, stream.opens)
    }


    @Test
    fun `a stream in backoff may reopen inside the window and still deliver`() = runTest {
        val stream = FakeStream(
            onOpen = { index, _ ->
                if (index == 1) flow<StreamFrame> { throw IOException("socket dropped") } else null
            },
        )
        val sink = RecordingSink()
        val session = session(stream, sink)
        val owner = live(session, stream, awaitHello = false)

        assertTrue(session.status.value is Session.Status.Offline)
        assertEquals(1, stream.opens)

        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        advanceTimeBy(1_000)
        runCurrent()
        assertEquals(2, stream.opens)

        stream.emit(hello("s:1", resumed = false))
        stream.emit(notify("done", seq = 12))
        runCurrent()
        assertEquals(1, sink.delivered.size)
        assertEquals(12, sink.delivered.single().second)

        advanceTimeBy(24_000)
        runCurrent()
        assertEquals(0, stream.collectors)
        assertNull(currentController.openWindow)
        advanceTimeBy(60_000)
        runCurrent()
        assertEquals(2, stream.opens)
    }

    @Test
    fun `an unauthorized session opens no window`() = runTest {
        val stream = FakeStream(
            onOpen = { _, _ -> flow<StreamFrame> { throw APIError.Status(401, "revoked") } },
        )
        val sink = RecordingSink()
        val session = session(stream, sink)
        val owner = live(session, stream, awaitHello = false)
        assertEquals(Session.Status.Unauthorized, session.status.value)

        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        advanceTimeBy(30_000)
        runCurrent()

        assertEquals(0, currentAnchor.startAttempts)
        assertNull(currentController.openWindow)
        assertEquals(1, stream.opens)
        assertEquals(Session.Status.Unauthorized, session.status.value)
    }

    @Test
    fun `a definitively unpaired app never starts the anchor`() = runTest {
        val stream = FakeStream()
        val sink = RecordingSink()
        val session = session(
            stream,
            sink,
            connections = store(null),
            tokenStore = tokens(TokenStore.ReadResult.Missing),
        )
        val owner = live(session, stream, awaitHello = false)
        assertEquals(Session.RestoreState.Unpaired, session.restoreState.value)
        assertNull(session.connection.value)

        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        advanceTimeBy(30_000)
        runCurrent()

        assertEquals(0, currentAnchor.startAttempts)
        assertEquals(0, stream.opens)
    }

    @Test
    fun `a restore still pending keeps the anchor without opening a second connection`() = runTest {
        val stream = FakeStream()
        val sink = RecordingSink()
        val session = session(
            stream,
            sink,
            tokenStore = tokens(TokenStore.ReadResult.Unavailable(locked = true, message = "locked")),
        )
        val owner = live(session, stream, awaitHello = false)
        assertEquals(Session.RestoreState.Pending, session.restoreState.value)

        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        runCurrent()
        assertEquals(listOf(1L), currentAnchor.started)
        assertEquals(0, stream.opens)

        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_START)
        runCurrent()
        assertEquals(listOf(1L), currentAnchor.stopped)
        assertEquals(0, stream.opens)
    }


    @Test
    fun `voice preview registered after the linger still stops at ON_STOP`() =
        assertVoicePreviewStopsAtOnce(registerPlayerFirst = false)

    @Test
    fun `voice preview registered before the linger still stops at ON_STOP`() =
        assertVoicePreviewStopsAtOnce(registerPlayerFirst = true)

    private fun assertVoicePreviewStopsAtOnce(registerPlayerFirst: Boolean) = runTest {
        val stream = FakeStream()
        val sink = RecordingSink()
        val session = session(stream, sink)
        val owner = TestOwner()
        val engine = SilentEngine()

        fun installPlayer() = VoicePreviewPlayer(
            controller = VoicePreviewController(
                engineFactory = { engine },
                focus = GrantingFocus(),
            ),
            processLifecycle = owner.registry,
        )

        val player = if (registerPlayerFirst) installPlayer() else null
        live(session, stream, owner = owner)
        val active = player ?: installPlayer()

        assertNull(active.play(byteArrayOf(1, 2, 3)))
        assertTrue(active.playing.value)

        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        runCurrent()

        assertFalse(active.playing.value)
        assertEquals(1, engine.stops)
        assertEquals(1, stream.collectors)
        stream.emit(notify("done", seq = 5))
        runCurrent()
        assertEquals(1, sink.delivered.size)
    }

    @Test
    fun `signing out during the window unpairs and clears avatars at once, and the stale timer is inert`() = runTest {
        val stream = FakeStream()
        val sink = RecordingSink()
        val session = session(stream, sink)
        val owner = live(session, stream)

        val avatars = AvatarImageStore(fetch = { byteArrayOf(7, 7, 7) }, decode = { null })
        val unpairedSeen = mutableListOf<Boolean>()
        backgroundScope.launch {
            session.status
                .map { it is Session.Status.Unpaired }
                .distinctUntilChanged()
                .collect { unpaired ->
                    unpairedSeen += unpaired
                    if (unpaired) avatars.clearBlocking()
                }
        }
        runCurrent()
        assertEquals(listOf(false), unpairedSeen)

        assertContentEquals(
            byteArrayOf(7, 7, 7),
            avatars.bytesFor(bot().copy(avatarUrl = "/api/attachments/a.png")),
        )
        assertEquals(1, avatars.cachedEntryCount())

        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        advanceTimeBy(3_000)
        runCurrent()
        assertEquals(1, stream.collectors)

        session.signOutAndAwait()
        runCurrent()

        assertEquals(listOf(false, true), unpairedSeen)
        assertEquals(0, avatars.cachedEntryCount())
        assertEquals(0, avatars.cachedByteCost())
        assertEquals(Session.Status.Unpaired, session.status.value)
        assertEquals(0, stream.collectors)
        assertNull(session.connection.value)

        advanceTimeBy(30_000)
        runCurrent()
        assertEquals(listOf(1L), currentAnchor.stopped)
        assertEquals(1, stream.opens)
        assertEquals(Session.Status.Unpaired, session.status.value)
    }


    private lateinit var currentAnchor: FakeAnchor
    private lateinit var currentController: SessionLingerController

    private suspend fun TestScope.live(
        session: Session,
        stream: FakeStream,
        anchor: FakeAnchor = FakeAnchor(),
        awaitHello: Boolean = true,
        owner: TestOwner = TestOwner(),
    ): TestOwner {
        val scene = installLive(session, stream, anchor, awaitHello, owner)
        currentAnchor = scene.anchor
        currentController = scene.controller
        return scene.owner
    }

    private fun delta(threadId: String, text: String, seq: Int): StreamFrame = StreamFrame(
        Frame.Runtime(
            RuntimeEvent(
                type = "content.delta",
                threadId = threadId,
                delta = text,
                streamKind = "assistant_text",
            ),
        ),
        seq = seq,
    )

    private class SilentEngine : PreviewAudioEngine {
        override var onCompletion: (() -> Unit)? = null
        override var onError: (() -> Unit)? = null
        var stops = 0
            private set

        override fun start(data: ByteArray): Boolean = true

        override fun stop() {
            stops += 1
        }

        override fun release() = Unit
    }

    private class GrantingFocus : PreviewAudioFocus {
        override fun request(onInterrupted: () -> Unit): Boolean = true
        override fun abandon() = Unit
    }
}
