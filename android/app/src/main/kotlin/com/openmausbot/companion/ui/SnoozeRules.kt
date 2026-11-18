// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.openmausbot.companion.core.BotTask
import com.openmausbot.companion.core.nextSnoozeExpiry
import kotlinx.coroutines.delay
import java.util.Calendar

object SnoozeRules {
    const val UNTIL_NEW_ACTIVITY = "Until new activity"
    const val UNTIL_SIX_PM = "Until 6 PM"
    const val UNTIL_NINE_AM_TOMORROW = "Until 9 AM tomorrow"
    const val STOP_SNOOZING = "Stop snoozing"

    enum class Preset(val label: String) {
        NEW_ACTIVITY(UNTIL_NEW_ACTIVITY),
        SIX_PM(UNTIL_SIX_PM),
        NINE_AM_TOMORROW(UNTIL_NINE_AM_TOMORROW);

        fun until(now: Long): Long = when (this) {
            NEW_ACTIVITY -> 0L
            SIX_PM -> sixPm(now)
            NINE_AM_TOMORROW -> nineAmTomorrow(now)
        }
    }

    val presets: List<Preset> = Preset.entries

    fun sixPm(now: Long): Long = atHour(now, daysAhead = 0, hour = 18, rollPastNow = true)

    fun nineAmTomorrow(now: Long): Long = atHour(now, daysAhead = 1, hour = 9, rollPastNow = false)

    private fun atHour(now: Long, daysAhead: Int, hour: Int, rollPastNow: Boolean): Long {
        val calendar = Calendar.getInstance().apply {
            timeInMillis = now
            add(Calendar.DAY_OF_MONTH, daysAhead)
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
            if (rollPastNow && timeInMillis <= now) add(Calendar.DAY_OF_MONTH, 1)
        }
        return calendar.timeInMillis
    }
}

@Composable
fun rememberSnoozeNow(tasks: List<BotTask>): Long {
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    val next = nextSnoozeExpiry(tasks, now)
    LaunchedEffect(next) {
        if (next != null) {
            delay(next - System.currentTimeMillis() + 1)
            now = System.currentTimeMillis()
        }
    }
    return now
}
