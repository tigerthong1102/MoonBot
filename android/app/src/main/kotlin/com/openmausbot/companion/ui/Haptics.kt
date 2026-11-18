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
    /** Android haptic CONFIRM requires API 30; SEGMENT_TICK requires API 34. */
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
