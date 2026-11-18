// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import kotlin.test.Test
import kotlin.test.assertEquals

class SpeechBubbleTest {

    @Test
    fun `the drop is the reference drop, scaled by the corner radius`() {
        assertEquals(68f, SpeechBubble.tailDrop(179.dp).value, TOLERANCE)
        assertEquals(34f, SpeechBubble.tailDrop(89.5.dp).value, TOLERANCE)
        assertEquals(22f * 68f / 179f, SpeechBubble.tailDrop(22.dp).value, TOLERANCE)
        assertEquals(0f, SpeechBubble.tailDrop(0.dp).value, TOLERANCE)
    }

    @Test
    fun `the default radius is the one the Swift declares`() {
        assertEquals(22f, SpeechBubble.CORNER_RADIUS.value, TOLERANCE)
        assertEquals(SpeechBubble.tailDrop(), SpeechBubble.tailDrop(22.dp))
    }

    @Test
    fun `at the reference cap radius the tail is the reference drawing itself`() {
        val curves = tailCurves(
            width = REFERENCE_ORIGIN_X,
            height = REFERENCE_ORIGIN_Y,
            radius = REFERENCE_CAP_RADIUS,
        )
        val expected = floatArrayOf(
            766.342f, 249.767f, 727.342f, 299.817f, 699.842f, 323.317f,
            699.842f, 323.317f, 677.085f, 338.817f, 674.342f, 354.817f,
            668.342f, 389.817f, 700.829f, 410.817f, 691.829f, 421.317f,
            684.629f, 429.717f, 615.056f, 378.235f, 580.342f, 361.317f,
        )
        assertEquals(24, curves.size)
        expected.indices.forEach { assertEquals(expected[it], curves[it], TOLERANCE) }
    }

    @Test
    fun `halving the radius halves every offset from the bubble's corner`() {
        val corner = Offset(300f, 120f)
        val full = tailCurves(corner.x, corner.y, REFERENCE_CAP_RADIUS)
        val half = tailCurves(corner.x, corner.y, REFERENCE_CAP_RADIUS / 2f)
        var index = 0
        while (index < full.size) {
            assertEquals((full[index] - corner.x) / 2f, half[index] - corner.x, TOLERANCE)
            assertEquals((full[index + 1] - corner.y) / 2f, half[index + 1] - corner.y, TOLERANCE)
            index += 2
        }
    }

    @Test
    fun `the tail lands back on the bottom edge, left of the corner`() {
        val curves = tailCurves(width = 200f, height = 90f, radius = REFERENCE_CAP_RADIUS)
        assertEquals(200f - 186f, curves[LAST_END_X], TOLERANCE)
        assertEquals(90f, curves[LAST_END_Y], TOLERANCE)
    }

    @Test
    fun `the leading tail is the trailing one mirrored about the centre line`() {
        val mirror = mirrorAcross(100f)
        assertEquals(Offset(70f, 7f), mirror.map(Offset(30f, 7f)))
        assertEquals(Offset(0f, 0f), mirror.map(Offset(100f, 0f)))
        assertEquals(Offset(50f, -3f), mirror.map(Offset(50f, -3f)))
    }

    @Test
    fun `what you said is filled with the mascot palette's blue, not the system's`() {
        assertEquals(0xFF377FE6.toInt(), BubbleColor.mine.toArgb())
        assertEquals(0xFFFFFFFF.toInt(), BubbleColor.mineText.toArgb())
    }

    private companion object {
        const val TOLERANCE = 1e-3f
        const val REFERENCE_CAP_RADIUS = 179f
        const val REFERENCE_ORIGIN_X = 766.342f
        const val REFERENCE_ORIGIN_Y = 361.317f

        const val LAST_END_X = 22
        const val LAST_END_Y = 23
    }
}
