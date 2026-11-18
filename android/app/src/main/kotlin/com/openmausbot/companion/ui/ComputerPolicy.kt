// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import com.openmausbot.companion.core.Bot

object ComputerPolicy {
    const val IDLE_EXPLANATION = "This bot's computer is only captured while it is working."
    const val CONFIRM_TITLE = "Open live cloud desktop?"
    const val CONFIRM_MESSAGE =
        "This gives this phone full control of the cloud computer, including anything " +
            "signed in inside it."
    const val VNC_NOTE =
        "Interactive VNC session. Access must be enabled for this phone in the computer's " +
            "Phone settings."
    const val OPEN_DESKTOP = "Open live cloud desktop"

    fun showsCloudDesktop(bot: Bot): Boolean =
        bot.computer == "cloud" && bot.cloudBackend != "vps"

    fun statusLabel(bot: Bot): String = if (bot.busy == true) "Preview" else "Idle"

    fun waitingHeadline(bot: Bot): String =
        if (bot.busy == true) "Waiting for a frame…" else "Nothing to show yet"

    fun explainsIdle(bot: Bot): Boolean = bot.busy != true
}

internal class ScreenWatch(
    private val start: (String) -> Unit,
    private val stop: (String) -> Unit,
) {
    private var watching: String? = null

    fun watch(botId: String) {
        if (watching == botId) return
        release()
        watching = botId
        start(botId)
    }

    fun release() {
        val current = watching ?: return
        watching = null
        stop(current)
    }
}
