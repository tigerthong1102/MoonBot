package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFails
import kotlin.test.assertNull

class SearchLandingTest {
    private fun page(range: IntRange, leaf: String = "m200") = ThreadPage(
        messages = range.map { Message("m$it", Message.Role.BOT, Message.Kind.TEXT, it.toDouble(), text = "Message $it", parentId = if (it > 1) "m${it - 1}" else null) },
        activeLeafId = leaf, hasMore = range.first > 1,
    )

    @Test
    fun connectsTheSearchHitToTheLiveBranchInsteadOfOnlyCachingIt() {
        var state = CompanionState().merge(page(151..200), "thread")
        val landing = SearchLanding("thread", "m25")
        state = landing.merge(page(1..50), state)
        assertEquals(SearchHistoryCursor.Around("m150"), landing.next(state))
        state = landing.merge(page(101..200), state)
        assertEquals(SearchHistoryCursor.Around("m100"), landing.next(state))
        state = landing.merge(page(51..150), state)
        assertNull(landing.next(state))
        assertEquals((1..200).map { "m$it" }, state.visibleTranscript("thread").map { it.id })
        assertEquals("m200", state.activeLeafIds["thread"])
    }

    @Test
    fun sparseLandingRecoversTheCurrentLeafBeforeReportingSuccess() {
        val landing = SearchLanding("thread", "m25")
        val state = landing.merge(page(1..50), CompanionState())
        assertEquals(SearchHistoryCursor.Latest, landing.next(state))
        landing.merge(page(151..200), state)
    }

    @Test
    fun malformedDuplicatePagesFailInsteadOfLoopingOrFocusingHiddenMessages() {
        val landing = SearchLanding("thread", "m25")
        val state = landing.merge(page(1..50), CompanionState().merge(page(151..200), "thread"))
        landing.next(state)
        assertFails { landing.merge(page(1..50), state) }
    }

    @Test
    fun historyAndRequestBudgetsRemainBounded() {
        assertFails { SearchLanding("thread", "m25", maximumBytes = 100).merge(page(1..50), CompanionState()) }
        val landing = SearchLanding("thread", "m25", maximumPages = 1)
        val state = landing.merge(page(1..50), CompanionState().merge(page(151..200), "thread"))
        assertFails { landing.next(state) }
    }

    @Test
    fun oldPagesCannotRollBackANewerStreamLeaf() {
        val landing = SearchLanding("thread", "m175")
        val state = landing.merge(page(151..200), CompanionState().merge(page(151..201, "m201"), "thread"))
        assertEquals("m201", state.activeLeafIds["thread"])
        assertEquals("m201", state.visibleTranscript("thread").last().id)
    }
}
