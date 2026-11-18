package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class BackgroundChannelApprovalTest {
    @Test
    fun coldHydrationRecoversPendingCardsOnAnUnselectedChannelTask() {
        val room = Room("room", "selected", "Fixture", emptyList(), GroupResponder("all"), "", false, 1.0,
            tasks = listOf(BotTask("background", "Review", 1.0, activity = "waiting-on-you")))
        val fleet = Fleet(emptyList(), listOf(room))
        val card = Message(id = "approval", role = Message.Role.BOT, kind = Message.Kind.OPTIONS, at = 1.0,
            card = OptionCard(title = "Allow?", subtitle = "", options = listOf("Allow", "Deny"), requestId = "request", tool = "fixture"))
        val state = CompanionState().hydrate(fleet.copy(groups = listOf(room)), mapOf("background" to ThreadPage(listOf(card)), "foreign" to ThreadPage(listOf(card))))
        assertEquals(listOf("background"), state.pendingApprovals.map { it.threadId })
        assertEquals(room.id, state.roomOwningTask("background")?.id)
        assertEquals("selected", state.rooms.single().threadId)
        assertTrue(state.transcript("foreign").isEmpty())
        val warm = CompanionState().hydrate(fleet.copy(groups = listOf(room))).apply(Frame.Message("background", card))
        assertEquals(listOf("background"), warm.pendingApprovals.map { it.threadId })
    }
}
