// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import android.os.Build
import android.view.HapticFeedbackConstants
import com.openmausbot.companion.core.ActivityDetail
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LiveTailTest {
    @Test
    fun `hidden reasoning keeps answer tokens and otherwise falls back to busy state`() {
        assertEquals(TranscriptTail.STREAM, LiveTail.of("Answer", "Thinking", true, ActivityDetail.HIDDEN))
        assertEquals(TranscriptTail.WORKING, LiveTail.of(null, "Thinking", true, ActivityDetail.HIDDEN))
        assertEquals(TranscriptTail.NONE, LiveTail.of(null, "Thinking", false, ActivityDetail.HIDDEN))
    }

    @Test
    fun `tokens of the reply win over everything else`() {
        assertEquals(
            TranscriptTail.STREAM,
            LiveTail.of(streaming = "Hel", reasoning = "thinking hard", busy = true),
        )
        assertEquals(
            TranscriptTail.STREAM,
            LiveTail.of(streaming = "Hel", reasoning = null, busy = false),
        )
    }

    @Test
    fun `reasoning shows only while there is no answer yet`() {
        assertEquals(
            TranscriptTail.REASONING,
            LiveTail.of(streaming = null, reasoning = "thinking hard", busy = true),
        )
        assertEquals(
            TranscriptTail.REASONING,
            LiveTail.of(streaming = "", reasoning = "thinking hard", busy = true),
        )
    }

    @Test
    fun `working is busy, and no stream, and no reasoning`() {
        assertEquals(
            TranscriptTail.WORKING,
            LiveTail.of(streaming = null, reasoning = null, busy = true),
        )
        assertEquals(
            TranscriptTail.WORKING,
            LiveTail.of(streaming = "", reasoning = "", busy = true),
        )
    }

    @Test
    fun `each of the three conditions alone is enough to withhold it`() {
        assertNotEquals(
            TranscriptTail.WORKING,
            LiveTail.of(streaming = null, reasoning = null, busy = false),
        )
        assertNotEquals(
            TranscriptTail.WORKING,
            LiveTail.of(streaming = "tokens", reasoning = null, busy = true),
        )
        assertNotEquals(
            TranscriptTail.WORKING,
            LiveTail.of(streaming = null, reasoning = "thoughts", busy = true),
        )
    }

    @Test
    fun `an idle chat ends at its last message`() {
        assertEquals(
            TranscriptTail.NONE,
            LiveTail.of(streaming = null, reasoning = null, busy = false),
        )
        assertEquals(
            TranscriptTail.NONE,
            LiveTail.of(streaming = "", reasoning = "", busy = false),
        )
    }

    @Test
    fun `the working row is announced with the bot's own name`() {
        assertEquals("Maus is working", LiveTail.workingLabel("Maus"))
        assertEquals("Scout is working", LiveTail.workingLabel("Scout"))
    }
}

class WorkingDotsTest {
    @Test
    fun `reduce motion holds every dot still, and none of them at nothing`() {
        for (index in 0 until WorkingDots.COUNT) {
            for (elapsed in listOf(0L, 250_000_000L, 7_400_000_000L)) {
                assertEquals(
                    WorkingDots.REST_ALPHA,
                    WorkingDots.alpha(index, elapsed, moving = false),
                    "dot $index at $elapsed ns",
                )
            }
        }
        assertTrue(WorkingDots.REST_ALPHA > WorkingDots.MIN_ALPHA)
    }

    @Test
    fun `moving, every dot stays inside its band`() {
        for (index in 0 until WorkingDots.COUNT) {
            for (step in 0..40) {
                val elapsed = step * WorkingDots.PERIOD_NANOS / 40
                val alpha = WorkingDots.alpha(index, elapsed, moving = true)
                assertTrue(
                    alpha >= WorkingDots.MIN_ALPHA - TOLERANCE &&
                        alpha <= WorkingDots.MAX_ALPHA + TOLERANCE,
                    "dot $index at $elapsed ns was $alpha",
                )
            }
        }
    }

    @Test
    fun `the three dots run behind one another rather than blinking together`() {
        val at = 300_000_000L
        val values = (0 until WorkingDots.COUNT).map { WorkingDots.alpha(it, at, moving = true) }
        assertEquals(WorkingDots.COUNT, values.toSet().size, "dots were in step: $values")
    }

    @Test
    fun `the wave repeats, so a bubble left open does not drift`() {
        val at = 120_000_000L
        val nineCyclesLater = at + WorkingDots.PERIOD_NANOS * 9
        for (index in 0 until WorkingDots.COUNT) {
            assertEquals(
                WorkingDots.alpha(index, at, moving = true),
                WorkingDots.alpha(index, nineCyclesLater, moving = true),
                TOLERANCE,
            )
        }
    }

    private companion object {
        const val TOLERANCE = 1e-4f
    }
}

class ActivityReceiptTest {
    @Test
    fun `no answer yet is running`() {
        assertEquals(ActivityStatus.RUNNING, ActivityReceipt.status(null))
        assertEquals("Running", ActivityReceipt.label(ActivityStatus.RUNNING))
    }

    @Test
    fun `ok true is success and ok false is error`() {
        assertEquals(ActivityStatus.SUCCESS, ActivityReceipt.status(true))
        assertEquals(ActivityStatus.ERROR, ActivityReceipt.status(false))
        assertEquals("Success", ActivityReceipt.label(ActivityStatus.SUCCESS))
        assertEquals("Error", ActivityReceipt.label(ActivityStatus.ERROR))
    }

    @Test
    fun `the three states are three, and the receipt carries no fourth`() {
        assertEquals(
            listOf(ActivityStatus.RUNNING, ActivityStatus.SUCCESS, ActivityStatus.ERROR),
            ActivityStatus.entries.toList(),
        )
    }

    @Test
    fun `success is the quiet one and says nothing extra on screen`() {
        assertTrue(ActivityReceipt.showsLabel(ActivityStatus.RUNNING))
        assertTrue(ActivityReceipt.showsLabel(ActivityStatus.ERROR))
        assertTrue(!ActivityReceipt.showsLabel(ActivityStatus.SUCCESS))
    }

    @Test
    fun `every state reaches a screen reader, success included`() {
        assertEquals("grep, running", ActivityReceipt.announcement("grep", ActivityStatus.RUNNING))
        assertEquals("grep, success", ActivityReceipt.announcement("grep", ActivityStatus.SUCCESS))
        assertEquals("grep, error", ActivityReceipt.announcement("grep", ActivityStatus.ERROR))
    }
}

class HapticSemanticsTest {
    @Test
    fun `a selection is one of the platform's ticks for a new discrete value`() {
        for (sdk in EVERY_RELEASE) {
            val chosen = CompanionHaptics.constant(HapticCue.SELECT, sdkInt = sdk)
            assertTrue(
                chosen in DISCRETE_CHOICE_TICKS,
                "API $sdk chose $chosen, which is not one of the platform's discrete-choice ticks",
            )
        }
    }

    @Test
    fun `a selection is never the gesture Android reserves for a context click`() {
        for (sdk in EVERY_RELEASE) {
            val chosen = CompanionHaptics.constant(HapticCue.SELECT, sdkInt = sdk)
            assertNotEquals(HapticFeedbackConstants.CONTEXT_CLICK, chosen, "API $sdk")
            assertNotEquals(HapticFeedbackConstants.LONG_PRESS, chosen, "API $sdk")
        }
    }

    @Test
    fun `a selection never feels like a send, on any release`() {
        for (sdk in EVERY_RELEASE) {
            assertNotEquals(
                CompanionHaptics.constant(HapticCue.SEND, sdkInt = sdk),
                CompanionHaptics.constant(HapticCue.SELECT, sdkInt = sdk),
                "API $sdk",
            )
        }
    }

    private companion object {
        val EVERY_RELEASE = listOf(26, 29, 30, 33, 34, 35, 37)

        val DISCRETE_CHOICE_TICKS = setOf(
            HapticFeedbackConstants.SEGMENT_TICK,
            HapticFeedbackConstants.SEGMENT_FREQUENT_TICK,
            HapticFeedbackConstants.CLOCK_TICK,
            HapticFeedbackConstants.TEXT_HANDLE_MOVE,
        )
    }
}

class HapticConstantPolicyTest {
    @Test
    fun `the chosen send effect is CONFIRM, from the release that introduced it`() {
        for (sdk in listOf(Build.VERSION_CODES.R, 34, 37)) {
            assertEquals(
                HapticFeedbackConstants.CONFIRM,
                CompanionHaptics.constant(HapticCue.SEND, sdkInt = sdk),
                "API $sdk",
            )
        }
    }

    @Test
    fun `the chosen send fallback below API 30 is KEYBOARD_TAP`() {
        for (sdk in 26..29) {
            assertEquals(
                HapticFeedbackConstants.KEYBOARD_TAP,
                CompanionHaptics.constant(HapticCue.SEND, sdkInt = sdk),
                "API $sdk",
            )
        }
    }

    @Test
    fun `the successful creation effect is CONFIRM, from the release that introduced it`() {
        for (sdk in listOf(Build.VERSION_CODES.R, 34, 37)) {
            assertEquals(
                HapticFeedbackConstants.CONFIRM,
                CompanionHaptics.constant(HapticCue.SUCCESS, sdkInt = sdk),
                "API $sdk",
            )
        }
    }

    @Test
    fun `successful creation stays quiet before Android has a completion effect`() {
        for (sdk in 26..29) {
            assertEquals(
                HapticFeedbackConstants.NO_HAPTICS,
                CompanionHaptics.constant(HapticCue.SUCCESS, sdkInt = sdk),
                "API $sdk",
            )
        }
    }

    @Test
    fun `the chosen selection effect is SEGMENT_TICK, from the release that introduced it`() {
        for (sdk in listOf(Build.VERSION_CODES.UPSIDE_DOWN_CAKE, 35, 37)) {
            assertEquals(
                HapticFeedbackConstants.SEGMENT_TICK,
                CompanionHaptics.constant(HapticCue.SELECT, sdkInt = sdk),
                "API $sdk",
            )
        }
    }

    @Test
    fun `the chosen selection fallback below API 34 is CLOCK_TICK`() {
        for (sdk in 26..33) {
            assertEquals(
                HapticFeedbackConstants.CLOCK_TICK,
                CompanionHaptics.constant(HapticCue.SELECT, sdkInt = sdk),
                "API $sdk",
            )
        }
    }
}

class TactileActionTest {
    @Test
    fun `each audited action keeps its intended cue`() {
        assertEquals(
            mapOf(
                TactileAction.OPEN_SEARCH_RESULT to HapticCue.SELECT,
                TactileAction.START_NEW_GROUP to HapticCue.SELECT,
                TactileAction.TOGGLE_GROUP_MEMBER to HapticCue.SELECT,
                TactileAction.OPEN_UPDATES to HapticCue.SELECT,
                TactileAction.OPEN_SEARCH to HapticCue.SELECT,
                TactileAction.CREATE_BOT_SUCCESS to HapticCue.SUCCESS,
                TactileAction.CREATE_GROUP_SUCCESS to HapticCue.SUCCESS,
                TactileAction.TOGGLE_REACTION to HapticCue.SELECT,
                TactileAction.CHOOSE_APPROVAL to HapticCue.SELECT,
                TactileAction.GRANT_APPROVAL to HapticCue.SELECT,
                TactileAction.START_NEW_SECTION to HapticCue.SELECT,
                TactileAction.TOGGLE_ACTIVITY_RUN to HapticCue.SELECT,
                TactileAction.OPEN_THREAD_CHIP to HapticCue.SELECT,
                TactileAction.SWITCH_COMPUTER to HapticCue.SELECT,
                TactileAction.CONNECT_ANOTHER_COMPUTER to HapticCue.SELECT,
                TactileAction.CHOOSE_QUICK_REPLY_ICON to HapticCue.SELECT,
            ),
            TactileAction.entries.associateWith { it.cue },
        )
    }
}

class CompanionHapticsTest {
    @Test
    fun `a command that sends is felt once, as a send`() {
        assertNull(CompanionHaptics.forCommand(SlashEffect.Send(com.openmausbot.companion.R.string.ui_diff_prompt)))
    }

    @Test
    fun `a command that navigates is felt as a selection`() {
        assertEquals(HapticCue.SELECT, CompanionHaptics.forCommand(SlashEffect.OpenComputer))
        assertEquals(HapticCue.SELECT, CompanionHaptics.forCommand(SlashEffect.OpenTasks))
    }

    @Test
    fun `every command in the HUD has an answer`() {
        val cues = SlashCommands.ALL.map { CompanionHaptics.forCommand(it.effect) }
        assertEquals(
            listOf(HapticCue.SELECT, HapticCue.SELECT, null, null, null),
            cues,
        )
    }
}

class CardClipboardTest {
    private class Recorder : Haptics {
        val written = mutableListOf<String>()
        val played = mutableListOf<HapticCue>()

        override fun play(cue: HapticCue) {
            played += cue
        }

        fun clipboard(): CardClipboard = CardClipboard(write = { written += it }, haptics = this)
    }

    @Test
    fun `Copy Diff writes the patch and confirms it exactly once`() {
        val recorder = Recorder()
        recorder.clipboard()("--- a/x\n+++ b/x\n+one")

        assertEquals(listOf("--- a/x\n+++ b/x\n+one"), recorder.written)
        assertEquals(listOf(HapticCue.SELECT), recorder.played)
    }

    @Test
    fun `Copy CSV writes the table and confirms it exactly once`() {
        val recorder = Recorder()
        recorder.clipboard()("id,name\n1,maus")

        assertEquals(listOf("id,name\n1,maus"), recorder.written)
        assertEquals(listOf(HapticCue.SELECT), recorder.played)
    }

    @Test
    fun `two copies are two ticks, not one and not three`() {
        val recorder = Recorder()
        val copy = recorder.clipboard()
        copy("first")
        copy("second")

        assertEquals(listOf("first", "second"), recorder.written)
        assertEquals(listOf(HapticCue.SELECT, HapticCue.SELECT), recorder.played)
    }

    @Test
    fun `a copy is confirmed as a selection, never as a send`() {
        val recorder = Recorder()
        recorder.clipboard()("anything")

        assertEquals(1, recorder.played.size)
        assertNotEquals(HapticCue.SEND, recorder.played.single())
    }

    @Test
    fun `the write happens even when it is the only half that can`() {
        val recorder = Recorder()
        recorder.clipboard()("payload")

        assertEquals(listOf("payload"), recorder.written)
    }
}
