// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import com.openmausbot.companion.core.QuickReply
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

class QuickReplyGlyphParityTest {

    @Test
    fun `every icon a reply can carry has a mark of its own`() {
        for (choice in QuickReply.ICON_CHOICES) {
            assertNotEquals(
                PLACEHOLDER,
                quickReplyGlyph(choice),
                "\"$choice\" is offered in the editor but falls through to the placeholder",
            )
        }
    }

    @Test
    fun `no two choices are drawn with the same mark`() {
        val marks = QuickReply.ICON_CHOICES.associateWith(::quickReplyGlyph)

        assertEquals(
            QuickReply.ICON_CHOICES.size,
            marks.values.toSet().size,
            "two icon choices share one mark: $marks",
        )
    }

    private companion object {
        val PLACEHOLDER = quickReplyGlyph("an id the table does not name")
    }
}
