// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.notifications

import com.openmausbot.companion.core.NotificationFrame
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class NotificationMappingTest {
    @Test
    fun blockingKindsUseHighImportanceChannel() {
        val approval = frame("approval")
        val question = frame("question")
        assertEquals(NotificationMapping.CHANNEL_BLOCKING, NotificationMapping.channelId(approval))
        assertEquals(NotificationMapping.CHANNEL_BLOCKING, NotificationMapping.channelId(question))
        assertTrue(NotificationMapping.isHighImportance(approval))
        assertTrue(NotificationMapping.isHighImportance(question))
    }

    @Test
    fun doneAndRoutineUseNormalChannels() {
        assertEquals(NotificationMapping.CHANNEL_DONE, NotificationMapping.channelId(frame("done")))
        assertEquals(
            NotificationMapping.CHANNEL_ROUTINE_FAILED,
            NotificationMapping.channelId(frame("routine-failed")),
        )
        assertFalse(NotificationMapping.isHighImportance(frame("done")))
    }

    @Test
    fun dedupeIdIncludesOriginAndRemainsStableAcrossReplay() {
        val notification = frame("approval", threadId = "thread-9", title = "Allow?")
        assertEquals("startupbot.7:fixture8:thread-9.42", NotificationMapping.dedupeId(notification, 42, "fixture"))
        assertEquals("startupbot.7:fixture8:thread-9.Allow?", NotificationMapping.dedupeId(notification, null, "fixture"))
        kotlin.test.assertNotEquals(NotificationMapping.dedupeId(notification, 42, "fixture"),
            NotificationMapping.dedupeId(notification, 42, "other"))
        assertEquals(NotificationMapping.dedupeId(notification, 42, "fixture"),
            NotificationMapping.dedupeId(notification, 42, "fixture"))
    }

    private fun frame(
        kind: String,
        threadId: String = "t1",
        title: String = "title",
    ) = NotificationFrame(
        kind = kind,
        botId = "b1",
        botName = "Scout",
        threadId = threadId,
        title = title,
        body = "body",
    )
}
