// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import kotlin.test.Test
import kotlin.test.assertEquals

class OverviewRulesTest {
    @Test
    fun `the title names the bot`() {
        assertEquals("What Maus does", OverviewRules.title("Maus"))
    }
}
