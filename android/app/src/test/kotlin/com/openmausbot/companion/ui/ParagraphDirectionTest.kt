// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.style.ResolvedTextDirection
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openmausbot.companion.core.TranscriptCard
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ParagraphDirectionTest {

    @get:Rule
    val compose = createComposeRule()

    private fun inRtlLocale(content: @Composable () -> Unit) {
        compose.setContent {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                CompanionTheme(darkTheme = false) { content() }
            }
        }
    }

    private fun inLtrLocale(content: @Composable () -> Unit) {
        compose.setContent {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                CompanionTheme(darkTheme = false) { content() }
            }
        }
    }

    private fun layoutOf(text: String): TextLayoutResult {
        val node = compose.onNodeWithText(text, useUnmergedTree = true).fetchSemanticsNode()
        val results = mutableListOf<TextLayoutResult>()
        val action = node.config[SemanticsActions.GetTextLayoutResult].action
        assertTrue(action != null && action(results), "the node produced no text layout")
        return results.first()
    }

    private fun TextLayoutResult.leftOf(offset: Int): Float = getBoundingBox(offset).left

    @Test
    fun `an English question keeps its LTR paragraph in an RTL locale`() {
        val question = "What do you mostly want help with?"
        inRtlLocale { MarkdownText(source = question, modifier = Modifier.requiredWidth(2000.dp)) }

        val layout = layoutOf(question)
        assertEquals(
            ResolvedTextDirection.Ltr,
            layout.getParagraphDirection(0),
            "English content must resolve to an LTR paragraph, whatever the locale mirrors",
        )
    }

    @Test
    fun `the question mark is drawn last, not first`() {
        val question = "What do you mostly want help with?"
        inRtlLocale { MarkdownText(source = question, modifier = Modifier.requiredWidth(2000.dp)) }

        val layout = layoutOf(question)
        val firstLetter = layout.leftOf(0)
        val questionMark = layout.leftOf(question.lastIndex)
        assertTrue(
            questionMark > firstLetter,
            "the '?' sat at x=$questionMark, left of the 'W' at x=$firstLetter — " +
                "that is the reordering that drew \"?What do you mostly want help with\"",
        )
        val rightmost = (0..question.lastIndex).maxOf { layout.leftOf(it) }
        assertEquals(questionMark, rightmost, "the '?' has to end the line")
    }

    @Test
    fun `a counted list stays in ascending order in an RTL locale`() {
        val counted = "1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20"
        inRtlLocale { MarkdownText(source = counted, modifier = Modifier.requiredWidth(2000.dp)) }

        val layout = layoutOf(counted)
        assertEquals(
            ResolvedTextDirection.Ltr,
            layout.getParagraphDirection(0),
            "digits are weak; with an RTL base level the whole sequence reverses",
        )

        val starts = buildList {
            var index = 0
            counted.split(" ").forEach { token -> add(index); index += token.length + 1 }
        }
        val xs = starts.map { layout.leftOf(it) }
        xs.zipWithNext().forEachIndexed { i, (left, right) ->
            assertTrue(
                right > left,
                "number ${i + 2} was drawn at x=$right, left of number ${i + 1} at x=$left — " +
                    "the sequence read backwards",
            )
        }
    }

    @Test
    fun `Arabic reads right to left on an English phone`() {
        inLtrLocale { MarkdownText(source = ARABIC, modifier = Modifier.requiredWidth(2000.dp)) }

        val layout = layoutOf(ARABIC)
        assertEquals(ResolvedTextDirection.Rtl, layout.getParagraphDirection(0))
        assertTrue(
            layout.leftOf(0) > layout.leftOf(ARABIC.lastIndex),
            "the first Arabic letter belongs on the right of the last one",
        )
    }

    @Test
    fun `Arabic still reads right to left on an Arabic phone`() {
        inRtlLocale { MarkdownText(source = ARABIC, modifier = Modifier.requiredWidth(2000.dp)) }

        val layout = layoutOf(ARABIC)
        assertEquals(ResolvedTextDirection.Rtl, layout.getParagraphDirection(0))
        assertTrue(
            layout.leftOf(0) > layout.leftOf(ARABIC.lastIndex),
            "the first Arabic letter belongs on the right of the last one",
        )
    }

    @Test
    fun `a one-line preview is cut at its end, not at its beginning`() {
        val preview = "error: CUA Driver is not ready for this computer yet"
        var captured: TextLayoutResult? = null
        inRtlLocale {
            Text(
                text = preview,
                fontSize = 15.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                onTextLayout = { captured = it },
                modifier = Modifier.requiredWidth(160.dp),
            )
        }
        compose.waitForIdle()

        val layout = requireNotNull(captured) { "the preview never reported a layout" }
        assertEquals(
            ResolvedTextDirection.Ltr,
            layout.getParagraphDirection(0),
            "an English preview reads LTR",
        )

        val visible = layout.getLineEnd(0, visibleEnd = true)
        assertTrue(visible < preview.length, "the line has to overflow for this to mean anything")

        assertTrue(
            layout.getLineLeft(0) >= 0f,
            "the line started at x=${layout.getLineLeft(0)}, outside its own box",
        )
        assertTrue(
            layout.getBoundingBox(0).left >= 0f,
            "the opening 'e' of \"error:\" was drawn at x=${layout.getBoundingBox(0).left}",
        )
        assertTrue(
            layout.getBoundingBox(visible - 1).left > layout.getBoundingBox(0).left,
            "the kept run has to read left to right",
        )
    }

    @Test
    fun `the data table still reads across and still mirrors`() {
        val languages = TranscriptCard.Table(
            headers = listOf("language", "year"),
            rows = listOf(listOf("Python", "1991"), listOf("Java", "1995")),
        )
        inRtlLocale { DataTableCard(languages) }

        fun spoken(node: SemanticsNode): List<String> = buildList {
            node.config.getOrNull(SemanticsProperties.Text)?.forEach { add(it.text) }
            node.config.getOrNull(SemanticsProperties.ContentDescription)?.forEach { add(it) }
            node.children.forEach { addAll(spoken(it)) }
        }
        assertEquals(
            listOf(
                "DATA TABLE", "2 rows",
                "LANGUAGE", "YEAR",
                "Python", "1991",
                "Java", "1995",
                "Copy CSV",
            ),
            spoken(compose.onRoot().fetchSemanticsNode()),
            "the reading order is row-major, mirrored or not",
        )

        fun left(text: String) =
            compose.onNodeWithText(text).fetchSemanticsNode().boundsInRoot.left
        assertTrue(
            left("LANGUAGE") > left("YEAR"),
            "the first column belongs on the right in an RTL locale",
        )
        assertTrue(
            left("Python") > left("1991"),
            "and so does the first cell of every row",
        )
    }

    private companion object {
        const val ARABIC = "مرحبا بك في أوبن ماوس"
    }
}
