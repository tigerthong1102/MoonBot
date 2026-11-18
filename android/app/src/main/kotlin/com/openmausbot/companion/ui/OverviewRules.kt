// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

object OverviewRules {
    fun title(name: String): String = "What $name does"

    const val EMPTY_DOES: String = "Nothing scheduled or learned yet."
    const val EMPTY_RECENT: String = "No changes recorded yet."
    const val FAILED: String = "Couldn't load the overview."

    const val WHO: String = "Who"
    const val DOES: String = "Does"
    const val REACHES: String = "Can reach"
    const val WONT: String = "Won't"
    const val RECENT: String = "Recent changes"
}
