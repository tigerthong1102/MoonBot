// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json

class QueuedSendTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun drained(id: String, queueId: String, text: String = "and add tests") = Message(
        id = id,
        role = Message.Role.USER,
        kind = Message.Kind.TEXT,
        at = 10.0,
        text = text,
        queueId = queueId,
    )

    private fun echo(busy: Boolean? = null) = com.openmausbot.companion.core.Bot(
        id = "b1",
        threadId = "t1",
        name = "Echo",
        title = "",
        description = "",
        notifications = true,
        color = "blue",
        unread = false,
        modelSelection = ModelSelection("codex", "gpt-5.5"),
        createdAt = 1.0,
        busy = busy,
    )

    private fun room() = Room(
        id = "g1",
        threadId = "gt1",
        name = "War Room",
        memberIds = listOf("b1"),
        defaultResponder = GroupResponder("mentions"),
        bulletin = "",
        unread = false,
        createdAt = 1.0,
    )


    @Test
    fun `a held send decodes as queued`() {
        val body = """{"ok":true,"queued":true,"queueId":"q1","threadId":"t1"}"""
        assertEquals(
            SendReceipt.Queued("q1", "t1"),
            json.decodeFromString<SendReceiptBody>(body).receipt(),
        )
    }

    @Test
    fun `queued thread ids are the rows the surfaces read`() {
        var state = CompanionState()
            .rememberQueued(QueuedSend("q1", "first"), "t1")
            .rememberQueued(QueuedSend("q2", "second"), "t2")
        assertEquals(setOf("t1", "t2"), state.queuedThreadIds)

        state = state.forgetQueued("q1", "t1")
        assertEquals(setOf("t2"), state.queuedThreadIds)

        state = state.forgetQueued("q2", "t2")
        assertEquals(emptySet(), state.queuedThreadIds)
    }

    @Test
    fun `a send taken into the running turn decodes as steered`() {
        val body = """{"ok":true,"steered":true,"threadId":"t1"}"""
        assertEquals(
            SendReceipt.Sent("t1", steered = true),
            json.decodeFromString<SendReceiptBody>(body).receipt(),
        )
    }

    @Test
    fun `an answer without mid-turn detail is a plain send`() {
        assertEquals(
            SendReceipt.Sent(null, steered = false),
            json.decodeFromString<SendReceiptBody>("""{"ok":true}""").receipt(),
        )
    }

    @Test
    fun `queued without an id falls back to a plain send`() {
        val body = """{"ok":true,"queued":true,"threadId":"t1"}"""
        assertEquals(
            SendReceipt.Sent("t1", steered = false),
            json.decodeFromString<SendReceiptBody>(body).receipt(),
        )
    }


    @Test
    fun `a bot queued frame replaces bot queues wholesale and tombstones vanished ids`() {
        val frame = json.decodeFromString<StreamFrame>(
            """{"kind":"bot.queued","queues":{"t1":[{"queueId":"q2","text":"queued elsewhere"}]}}""",
        ).frame
        var state = CompanionState()
            .apply(Frame.Bot(echo(busy = true)))
            .apply(Frame.Room(room()))
            .rememberQueued(QueuedSend("q1", "mine"), "t1")
            .rememberQueued(QueuedSend("r1", "held for the room"), "gt1")
        state = state.apply(frame)

        assertEquals(listOf("queued elsewhere"), state.pendingQueued["t1"]?.map { it.text })
        assertEquals(listOf("held for the room"), state.pendingQueued["gt1"]?.map { it.text })

        state = state.rememberQueued(QueuedSend("q1", "mine"), "t1")
        assertEquals(listOf("queued elsewhere"), state.pendingQueued["t1"]?.map { it.text })
    }

    @Test
    fun `a fleet snapshot re-seeds queues this window never queued`() {
        val fleet = json.decodeFromString<Fleet>(
            """{"bots":[
              {"id":"b1","threadId":"t1","name":"Echo","title":"","description":"","notifications":true,"color":"blue","unread":false,"modelSelection":{"instanceId":"i1","model":"m1"},"createdAt":1}
            ],"groups":[],"botQueuedMessages":{"t1":[{"queueId":"q9","text":"queued elsewhere"}]}}""",
        )
        val state = CompanionState().hydrate(fleet)
        assertEquals(setOf("t1"), state.queuedThreadIds)
        assertEquals(listOf("queued elsewhere"), state.pendingQueued["t1"]?.map { it.text })
    }

    @Test
    fun `a queue drained while this window was away is forgotten on reconnect`() {
        val away = CompanionState()
            .apply(Frame.Bot(echo(busy = true)))
            .rememberQueued(QueuedSend("q1", "held before the drop"), "t1")

        val reconnected = away.hydrate(
            Fleet(bots = listOf(echo()), groups = emptyList(), botQueuedMessages = emptyMap()),
        )
        assertNull(reconnected.pendingQueued["t1"])

        val late = reconnected.rememberQueued(QueuedSend("q1", "held before the drop"), "t1")
        assertEquals(emptySet(), late.queuedThreadIds)
    }

    @Test
    fun `an empty authoritative snapshot rejects an unseen late receipt`() {
        val before = CompanionState()
        val after = before.replaceBotQueues(emptyMap())
        assertEquals(before.botQueueRevision + 1, after.botQueueRevision)
        val late = after.rememberQueued(QueuedSend("unseen", "cancelled elsewhere"), "t1", before.botQueueRevision)
        assertTrue(late.pendingQueued.isEmpty())
        assertTrue(late.drainedQueueIds.isEmpty())
    }

    @Test
    fun `current receipts and independent room queues remain visible`() {
        val state = CompanionState().replaceBotQueues(emptyMap())
        val current = state.rememberQueued(QueuedSend("new", "current"), "t1", state.botQueueRevision)
        assertEquals("new", current.pendingQueued["t1"]?.single()?.queueId)
        val room = state.rememberQueued(QueuedSend("room", "independent"), "gt1")
        assertEquals("room", room.pendingQueued["gt1"]?.single()?.queueId)
    }


    @Test
    fun `a held send stays on screen until its line lands`() {
        var state = CompanionState().rememberQueued(QueuedSend("q1", "and add tests"), "t1")
        assertEquals(listOf("and add tests"), state.pendingQueued["t1"]?.map { it.text })

        state = state.apply(Frame.Message("t1", drained("m1", "q1")))
        assertNull(state.pendingQueued["t1"])
        assertEquals(1, state.transcript("t1").size)
    }

    @Test
    fun `holds are kept in send order and never twice`() {
        val state = CompanionState()
            .rememberQueued(QueuedSend("q1", "first"), "t1")
            .rememberQueued(QueuedSend("q2", "second"), "t1")
            .rememberQueued(QueuedSend("q1", "first"), "t1")
        assertEquals(listOf("first", "second"), state.pendingQueued["t1"]?.map { it.text })
    }

    @Test
    fun `a drain that beats its own receipt does not resurrect the row`() {
        val state = CompanionState()
            .apply(Frame.Message("t1", drained("m1", "q1")))
            .rememberQueued(QueuedSend("q1", "and add tests"), "t1")
        assertNull(state.pendingQueued["t1"])
    }

    @Test
    fun `the tombstone is spent once`() {
        val state = CompanionState()
            .apply(Frame.Message("t1", drained("m1", "q1")))
            .rememberQueued(QueuedSend("q1", "first"), "t1")
            .rememberQueued(QueuedSend("q1", "first"), "t1")
        assertEquals(listOf("first"), state.pendingQueued["t1"]?.map { it.text })
    }

    @Test
    fun `cancelling a hold removes it and only it`() {
        var state = CompanionState()
            .rememberQueued(QueuedSend("q1", "first"), "t1")
            .rememberQueued(QueuedSend("q2", "second"), "t1")
        state = state.forgetQueued("q1", "t1")
        assertEquals(listOf("second"), state.pendingQueued["t1"]?.map { it.text })
        state = state.forgetQueued("q2", "t1")
        assertNull(state.pendingQueued["t1"])
    }

    @Test
    fun `holds are kept per thread`() {
        val state = CompanionState()
            .rememberQueued(QueuedSend("q1", "first"), "t1")
            .rememberQueued(QueuedSend("q2", "second"), "t2")
            .apply(Frame.Message("t1", drained("m1", "q1")))
        assertNull(state.pendingQueued["t1"])
        assertEquals(listOf("second"), state.pendingQueued["t2"]?.map { it.text })
    }

    @Test
    fun `a wholesale transcript replacement retires the row`() {
        var state = CompanionState().apply(Frame.Bot(echo()))
        state = state.rememberQueued(QueuedSend("q1", "Count to 5"), "t1")
        assertEquals(1, state.pendingQueued["t1"]?.size)

        state = state.apply(Frame.Bot(echo().copy(messages = listOf(drained("m1", "q1")))))
        assertNull(state.pendingQueued["t1"])
    }

    @Test
    fun `an idle bot has nothing streaming`() {
        var state = CompanionState().apply(Frame.Bot(echo(busy = true)))
        state = state.apply(
            Frame.Runtime(RuntimeEvent("content.delta", "t1", "A History of Comp", "assistant_text")),
        )
        assertTrue(state.streaming["t1"].orEmpty().isNotEmpty())

        state = state.apply(Frame.Bot(echo(busy = false)))
        assertNull(state.streaming["t1"])
    }


    @Test
    fun `a transcript line carries its mid-turn markers`() {
        val body = """{"id":"m1","role":"user","kind":"text","at":1,"text":"stop","steered":true}"""
        val message = json.decodeFromString<Message>(body)
        assertEquals(true, message.steered)
        assertNull(message.queueId)
    }

    @Test
    fun `an engine that can take words into a turn says so`() {
        val body = """{"images":true,"queueing":true}"""
        assertEquals(true, json.decodeFromString<InstanceCapabilities>(body).queueing)
    }

    @Test
    fun `editing a held send leads with its words and keeps the typed draft`() {
        val send = QueuedSend("q1", "actually stop at 10")
        assertEquals("actually stop at 10", send.editDraft(keeping = ""))
        assertEquals("actually stop at 10", send.editDraft(keeping = "  \n"))
        assertEquals(
            "actually stop at 10\n\nand use the smaller model",
            send.editDraft(keeping = "and use the smaller model"),
        )
    }
}
