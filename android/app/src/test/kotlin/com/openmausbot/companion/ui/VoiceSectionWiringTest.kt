// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.material3.Text
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.openmausbot.companion.core.ConfigFlag
import com.openmausbot.companion.core.ConfigStatus
import kotlin.test.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class VoiceSectionWiringTest {

    @get:Rule
    val compose = createComposeRule()

    private val pickerSlot = "voice-picker-slot"

    private val elevenLabsNotice = "ElevenLabs is not configured"
    private val elevenLabsFooter =
        "Add the shared ElevenLabs key in this agent's profile on the computer. " +
            "The key is never returned to this phone."
    private val readyFooter =
        "The voice choice belongs to this agent. Workspace default uses the shared voice " +
            "selected on your computer."
    private val systemNotice = "Your computer's built-in voices are unavailable"
    private val systemFooter =
        "Your computer's built-in voices need no key, and it reports none it can use. " +
            "Switch the voice engine in StartupBot on the computer to turn speech back on."
    private val chatterboxNotice = "The Chatterbox server is not connected"
    private val chatterboxFooter =
        "Add the address of your Chatterbox server in StartupBot on the computer to turn " +
            "speech back on."

    private val engine = listOf("Voice engine")

    private fun spoken(node: SemanticsNode): List<String> = buildList {
        node.config.getOrNull(SemanticsProperties.Text)?.forEach { add(it.text) }
        node.children.forEach { addAll(spoken(it)) }
    }

    private fun sectionFor(config: ConfigStatus?): List<String> {
        compose.setContent {
            CompanionTheme(darkTheme = false) {
                VoiceSection(config = config) { Text(pickerSlot) }
            }
        }
        return spoken(compose.onRoot().fetchSemanticsNode())
    }

    @Test
    fun `the unconfigured section states the engine, then explains the remedy`() {
        assertEquals(
            listOf("VOICE") + engine + listOf(elevenLabsNotice, elevenLabsFooter),
            sectionFor(ConfigStatus(tts = ConfigFlag(configured = false))),
            "the short state stands in for the picker; the remedy is the footer under it",
        )
    }

    @Test
    fun `a section that can speak draws the picker under the ready footer`() {
        assertEquals(
            listOf("VOICE") + engine + listOf(pickerSlot, readyFooter),
            sectionFor(ConfigStatus(tts = ConfigFlag(configured = true, voice = "shared-voice"))),
        )
    }

    @Test
    fun `the built-in provider's section names no brand in either slot`() {
        val drawn = sectionFor(ConfigStatus(tts = ConfigFlag(configured = false, provider = "system")))

        assertEquals(listOf("VOICE") + engine + listOf(systemNotice, systemFooter), drawn)
        drawn.forEach { line ->
            assertEquals(false, line.contains("ElevenLabs"), "no brand reaches the screen: $line")
        }
    }

    @Test
    fun `the built-in provider keeps the picker and the shared footer when it can speak`() {
        assertEquals(
            listOf("VOICE") + engine + listOf(pickerSlot, readyFooter),
            sectionFor(
                ConfigStatus(tts = ConfigFlag(configured = true, voice = "Albert", provider = "system")),
            ),
        )
    }

    @Test
    fun `the chatterbox section offers the switch that repairs it`() {
        assertEquals(
            listOf("VOICE") + engine + listOf(chatterboxNotice, chatterboxFooter),
            sectionFor(ConfigStatus(tts = ConfigFlag(configured = false, provider = "chatterbox"))),
            "an engine whose credential is missing is exactly when switching engines matters",
        )
    }
}
