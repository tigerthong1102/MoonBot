// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PhoneSectionCopyTest {

    private val retiredSectionNames = listOf(
        "Settings → Companion",
        "Companion panel",
        "shown by Companion",
        "companion settings",
        "Companion settings",
    )

    @Test
    fun `pairing sends the person to Settings then Phone`() {
        val screen = sourceFile("ui/PairingScreen.kt").readText()
        val resources = listOf(
            "ui_1_open_startupbot_settings_phone" to "Settings → Phone",
            "pairing_no_address" to "Phone settings",
            "pairing_tailscale_help" to "Phone settings",
            "pairing_manual_help" to "Phone settings",
        )
        for ((id, english) in resources) {
            assertTrue(screen.contains("R.string.$id"))
            assertTrue(message("values", id).contains(english))
            assertTrue(message("values-vi", id).contains("Điện thoại"))
        }
    }

    @Test
    fun `every discovery failure points at Phone settings`() {
        val source = sourceFile("discovery/NsdDiscovery.kt").readText()




        assertEquals(
            4,
            countOf(source, "Enter the address shown in Phone settings below."),
            "every discovery failure must send the person to Phone settings",
        )
    }

    @Test
    fun `a revoked phone is told which desktop section removed it`() {
        val id = "ui_it_was_removed_from_the_computer_s_phone_settings_or_the_pairing"
        assertTrue(sourceFile("ui/RootScreen.kt").readText().contains("R.string.$id"))
        assertTrue(message("values", id).contains("Phone settings"))
        assertTrue(message("values-vi", id).contains("Điện thoại"))
    }

    @Test
    fun `no instruction still teaches the retired section name`() {
        for (name in listOf(
            "ui/PairingScreen.kt",
            "discovery/NsdDiscovery.kt",
            "ui/RootScreen.kt",
            "ui/SettingsPolicy.kt",
            "ui/SettingsScreen.kt",
            "ui/ComputerPolicy.kt",
        )) {
            val source = sourceFile(name).readText()
            for (retired in retiredSectionNames) {
                assertFalse(
                    source.contains(retired),
                    "$name still names \"$retired\" — the desktop section is called Phone",
                )
            }
        }
    }

    private fun message(folder: String, id: String): String {
        val document = javax.xml.parsers.DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(locate("src/main/res/$folder/interface.xml"))
        val nodes = document.getElementsByTagName("string")
        return (0 until nodes.length).map { nodes.item(it) as org.w3c.dom.Element }
            .single { it.getAttribute("name") == id }.textContent
    }

    private fun countOf(source: String, needle: String): Int =
        source.split(needle).size - 1

    private fun sourceFile(name: String): File =
        locate("src/main/kotlin/com/openmausbot/companion/$name")

    private fun locate(relative: String): File {
        var directory: File? = File(".").absoluteFile
        while (directory != null) {
            for (prefix in listOf("", "app/")) {
                val file = File(directory, prefix + relative)
                if (file.isFile) return file
            }
            directory = directory.parentFile
        }
        error("could not find $relative from ${File(".").absolutePath}")
    }
}
