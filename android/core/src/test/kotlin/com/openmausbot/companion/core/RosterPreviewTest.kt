// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals

class RosterPreviewTest {
    private fun text(id: String, body: String, at: Double = 1.0): Message = Message(
        id = id,
        role = Message.Role.BOT,
        kind = Message.Kind.TEXT,
        at = at,
        text = body,
    )

    private fun activity(
        id: String,
        name: String,
        at: Double = 1.0,
        ok: Boolean? = true,
    ): Message = Message(
        id = id,
        role = Message.Role.BOT,
        kind = Message.Kind.ACTIVITY,
        at = at,
        tool = ToolActivity(name = name, ok = ok),
    )

    private fun card(
        id: String,
        title: String,
        subtitle: String,
        at: Double = 1.0,
        pending: Boolean = true,
    ): Message = Message(
        id = id,
        role = Message.Role.BOT,
        kind = Message.Kind.OPTIONS,
        at = at,
        card = OptionCard(
            title = title,
            subtitle = subtitle,
            options = listOf("Allow", "Deny"),
            requestId = if (pending) "req-$id" else null,
        ),
    )


    @Test
    fun fullShowsTheToolNameWhenActivityLanded() {
        val messages = listOf(text("a", "hello"), activity("b", "auto-approved shell: export PATH=…"))
        assertEquals("auto-approved shell: export PATH=…", rosterPreview(messages, ActivityDetail.FULL))
    }


    @Test
    fun hiddenFallsBackToTheLastRealMessage() {
        val messages = listOf(
            text("a", "Deployed to staging"),
            activity("b", "auto-approved shell: export PATH=…"),
        )
        assertEquals("Deployed to staging", rosterPreview(messages, ActivityDetail.HIDDEN))
    }

    @Test
    fun hiddenSkipsAWholeTrailOfActivity() {
        val messages = listOf(
            text("a", "Deployed to staging"),
            activity("b", "shell"),
            activity("c", "read"),
            activity("d", "write"),
        )
        assertEquals("Deployed to staging", rosterPreview(messages, ActivityDetail.HIDDEN))
    }

    @Test
    fun hiddenShowsNothingWhenTheThreadIsOnlyActivity() {
        val messages = listOf(activity("a", "shell"), activity("b", "read"))
        assertEquals("", rosterPreview(messages, ActivityDetail.HIDDEN))
    }

    @Test
    fun hiddenStillShowsAPendingCard() {
        val messages = listOf(activity("a", "shell"), card("b", "Run this?", "rm -rf build"))
        assertEquals("rm -rf build", rosterPreview(messages, ActivityDetail.HIDDEN))
    }

    @Test
    fun aPendingCardSurvivesEveryLevel() {
        val messages = listOf(activity("a", "shell"), card("b", "Run this?", "rm -rf build"))
        for (detail in ActivityDetail.entries) {
            assertEquals("rm -rf build", rosterPreview(messages, detail), detail.name)
        }
    }

    @Test
    fun anAnsweredCardPreviewsAsItsTitle() {
        val messages = listOf(card("a", "Run this?", "rm -rf build", pending = false))
        assertEquals("Run this?", rosterPreview(messages, ActivityDetail.HIDDEN))
    }


    @Test
    fun reducedSummarisesATrailingRun() {
        val messages = listOf(
            text("a", "hi"),
            activity("b", "shell"),
            activity("c", "read"),
            activity("d", "write"),
        )
        assertEquals("Ran 3 steps", rosterPreview(messages, ActivityDetail.REDUCED))
    }

    @Test
    fun reducedSaysRunningWhileAStepIsUnfinished() {
        val messages = listOf(activity("a", "shell"), activity("b", "read", ok = null))
        assertEquals("Running 2 steps", rosterPreview(messages, ActivityDetail.REDUCED))
    }

    @Test
    fun reducedLeavesALoneActivityAsItsToolName() {
        val messages = listOf(text("a", "hi"), activity("b", "shell"))
        assertEquals("shell", rosterPreview(messages, ActivityDetail.REDUCED))
    }

    @Test
    fun reducedStillShowsAFailureRatherThanFoldingIt() {
        val messages = listOf(activity("a", "shell"), activity("b", "deploy", ok = false))
        assertEquals("deploy", rosterPreview(messages, ActivityDetail.REDUCED))
    }


    @Test
    fun textAndScreenReadTheSameAtEveryLevel() {
        val screen = Message(id = "s", role = Message.Role.BOT, kind = Message.Kind.SCREEN, at = 2.0)
        for (detail in ActivityDetail.entries) {
            assertEquals("plain words", rosterPreview(listOf(text("a", "plain words")), detail))
            assertEquals("Screenshot", rosterPreview(listOf(screen), detail))
        }
    }

    @Test
    fun emptyThreadPreviewsAsEmptyAtEveryLevel() {
        for (detail in ActivityDetail.entries) {
            assertEquals("", rosterPreview(emptyList(), detail))
        }
    }


    @Test
    fun theRosterRowFoldsByTheReadersLevelButKeepsTheTrueLastActivity() {
        val state = CompanionState(
            bots = listOf(sampleBot("b", "t")),
            messages = mapOf(
                "t" to listOf(
                    text("a", "Deployed to staging", at = 10.0),
                    activity("b", "auto-approved shell: export PATH=…", at = 20.0),
                ),
            ),
        )

        assertEquals(
            "auto-approved shell: export PATH=…",
            state.chatSummaries(ActivityDetail.FULL).single().preview,
        )
        assertEquals(
            "Deployed to staging",
            state.chatSummaries(ActivityDetail.HIDDEN).single().preview,
        )
        for (detail in ActivityDetail.entries) {
            assertEquals(20.0, state.chatSummaries(detail).single().lastActivity, detail.name)
        }
    }

    @Test
    fun theDefaultLevelIsFull() {
        val state = CompanionState(
            bots = listOf(sampleBot("b", "t")),
            messages = mapOf("t" to listOf(activity("a", "shell"))),
        )
        assertEquals("shell", state.chatSummaries().single().preview)
    }

    private fun sampleBot(id: String, threadId: String) = Bot(
        id = id,
        threadId = threadId,
        name = id,
        title = "role",
        description = "",
        notifications = true,
        color = "green",
        unread = false,
        modelSelection = ModelSelection("i", "m"),
        createdAt = 0.0,
    )
}
