// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import android.os.Build
import android.view.HapticFeedbackConstants
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalView

enum class HapticCue {
    SEND,

    SELECT,

    SUCCESS,
}

internal enum class TactileAction(val cue: HapticCue) {
    OPEN_SEARCH_RESULT(HapticCue.SELECT),
    START_NEW_GROUP(HapticCue.SELECT),
    TOGGLE_GROUP_MEMBER(HapticCue.SELECT),
    OPEN_UPDATES(HapticCue.SELECT),
    OPEN_SEARCH(HapticCue.SELECT),
    CREATE_BOT_SUCCESS(HapticCue.SUCCESS),
    CREATE_GROUP_SUCCESS(HapticCue.SUCCESS),
    TOGGLE_REACTION(HapticCue.SELECT),
    CHOOSE_APPROVAL(HapticCue.SELECT),
    GRANT_APPROVAL(HapticCue.SELECT),

    START_NEW_SECTION(HapticCue.SELECT),

    TOGGLE_ACTIVITY_RUN(HapticCue.SELECT),

    OPEN_THREAD_CHIP(HapticCue.SELECT),

    SWITCH_COMPUTER(HapticCue.SELECT),

    CONNECT_ANOTHER_COMPUTER(HapticCue.SELECT),

    CHOOSE_QUICK_REPLY_ICON(HapticCue.SELECT),
}

object CompanionHaptics {
    /**
     * [HapticFeedbackConstants] for a cue, given the platform running it.
     *
     * The constant has to name the action, not merely produce a buzz: the
     * platform routes each one through its own effect, and a device with a
     * richer actuator plays them apart. So each cue is the constant Android
     * defines for what actually happened, with a fallback chosen for the same
     * gesture rather than for convenience.
     *
     * **Send.** `CONFIRM` is what the platform means by "that worked", and it
     * arrived in API 30. Below that the view would be handed an effect it does
     * not know and would do nothing at all, so 26..29 fall back to
     * `KEYBOARD_TAP` — the honest description of what happened there: a key was
     * pressed and the message went.
     *
     * **Select.** Every site that plays it is a move to one of a set of discrete
     * things — a command card, a disclosure opening or closing, a discovered
     * computer, a copy landing on the clipboard. From API 34 the platform has a
     * constant that says precisely that: `SEGMENT_TICK`, documented as "the user
     * is switching between a series of potential choices, for example items in a
     * list or discrete points on a slider".
     *
     * Below 34 the fallback is `CLOCK_TICK` (API 21). Its javadoc names the
     * clock — "an hour or minute tick" — but that *is* the pre-34 vocabulary for
     * landing on the next discrete value, which is why the framework's own
     * pickers play it, and it is the softest tick of that family. Explicitly not
     * `CONTEXT_CLICK`: Android defines that as "the user has performed a context
     * click on an object", the secondary gesture — a stylus button, a
     * right-click — and not one of these sites is one. Explicitly not
     * `KEYBOARD_TAP` either: that is the send's fallback, and a selection that
     * felt identical to a send would collapse the two cues into one.
     *
     * **Success.** `CONFIRM` is Android's explicit successful-completion effect,
     * and is therefore the cue for a bot or group the computer actually made.
     * It arrived in API 30. Before that, there is no honest equivalent: a virtual
     * key or long press would describe the initial tap rather than the later
     * result, so `NO_HAPTICS` deliberately keeps the success quiet.
     */
    fun constant(cue: HapticCue, sdkInt: Int = Build.VERSION.SDK_INT): Int = when (cue) {
        HapticCue.SEND ->
            if (sdkInt >= Build.VERSION_CODES.R) {
                HapticFeedbackConstants.CONFIRM
            } else {
                HapticFeedbackConstants.KEYBOARD_TAP
            }

        HapticCue.SELECT ->
            if (sdkInt >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                HapticFeedbackConstants.SEGMENT_TICK
            } else {
                HapticFeedbackConstants.CLOCK_TICK
            }

        HapticCue.SUCCESS ->
            if (sdkInt >= Build.VERSION_CODES.R) {
                HapticFeedbackConstants.CONFIRM
            } else {
                HapticFeedbackConstants.NO_HAPTICS
            }
    }

    fun forCommand(effect: SlashEffect): HapticCue? = when (effect) {
        is SlashEffect.Send -> null
        SlashEffect.OpenComputer, SlashEffect.OpenTasks -> HapticCue.SELECT
    }
}

fun interface Haptics {
    fun play(cue: HapticCue)
}

internal fun Haptics.play(action: TactileAction) = play(action.cue)

@Composable
fun rememberHaptics(): Haptics {
    val view = LocalView.current
    return remember(view) {
        Haptics { cue ->
            val constant = CompanionHaptics.constant(cue)
            if (constant != HapticFeedbackConstants.NO_HAPTICS) {
                view.performHapticFeedback(constant)
            }
        }
    }
}
