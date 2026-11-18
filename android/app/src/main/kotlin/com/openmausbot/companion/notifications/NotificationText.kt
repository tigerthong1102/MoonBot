// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.notifications

import android.os.Build
import android.text.TextDirectionHeuristics

/** Android RemoteViews text does not inherit Compose layout direction. */
internal object NotificationText {

    private const val LEFT_TO_RIGHT_MARK = '\u200E'

    private const val PARAGRAPH_BREAK = '\n'

    private const val CARRIAGE_RETURN = '\r'

    private const val COMPAT_KEEPS = 5120

    /** `Notification.MAX_CHARSEQUENCE_LENGTH` on API 26–30. */
    private const val FRAMEWORK_KEEPS_BEFORE_S = 5 * 1024

    /** `Notification.MAX_CHARSEQUENCE_LENGTH` from API 31. */
    private const val FRAMEWORK_KEEPS_FROM_S = 1024

    fun anchored(text: String): String =
        anchored(text, mostTheShadeKeeps(Build.VERSION.SDK_INT))

    internal fun mostTheShadeKeeps(sdkInt: Int): Int = minOf(
        COMPAT_KEEPS,
        if (sdkInt >= Build.VERSION_CODES.S) FRAMEWORK_KEEPS_FROM_S else FRAMEWORK_KEEPS_BEFORE_S,
    )

    private fun anchored(text: String, keeps: Int): String {
        if (text.isEmpty()) return text
        val anchored = StringBuilder(minOf(keeps, text.length + 1))
        var start = 0
        while (anchored.length < keeps) {
            val room = keeps - anchored.length
            val reach = minOf(text.length, start + room)
            val breakAt = firstBreakIn(text, start, reach)
            val end = if (breakAt < 0) reach else breakAt
            val content =
                if (breakAt > start && text[breakAt - 1] == CARRIAGE_RETURN) breakAt - 1 else end
            if (content > start && room > 1 && !settlesItsOwnDirection(text, start, content)) {
                anchored.append(LEFT_TO_RIGHT_MARK)
            }
            anchored.append(text, start, minOf(end, start + (keeps - anchored.length)))
            if (breakAt < 0) break
            if (anchored.length < keeps) anchored.append(PARAGRAPH_BREAK)
            start = breakAt + 1
        }
        return anchored.toString()
    }

    private fun firstBreakIn(text: String, from: Int, until: Int): Int {
        var i = from
        while (i < until) {
            if (text[i] == PARAGRAPH_BREAK) return i
            i++
        }
        return -1
    }

    private fun settlesItsOwnDirection(text: String, start: Int, end: Int): Boolean {
        val count = end - start
        return TextDirectionHeuristics.FIRSTSTRONG_LTR.isRtl(text, start, count) ==
            TextDirectionHeuristics.FIRSTSTRONG_RTL.isRtl(text, start, count)
    }
}
