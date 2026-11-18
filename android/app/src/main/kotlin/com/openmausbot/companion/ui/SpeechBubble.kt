// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.Matrix
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp


enum class BubbleTail { NONE, LEADING, TRAILING }

@Immutable
data class SpeechBubbleShape(
    val tail: BubbleTail,
    val cornerRadius: Dp = SpeechBubble.CORNER_RADIUS,
) : Shape {
    override fun createOutline(
        size: Size,
        layoutDirection: LayoutDirection,
        density: Density,
    ): Outline {
        val radius = minOf(
            with(density) { cornerRadius.toPx() },
            size.height / 2f,
            size.width / 2f,
        )
        if (tail == BubbleTail.NONE) {
            return Outline.Rounded(
                RoundRect(
                    rect = Rect(0f, 0f, size.width, size.height),
                    cornerRadius = CornerRadius(radius),
                ),
            )
        }
        val path = trailingTailPath(size, radius)
        if (tail == BubbleTail.LEADING) {
            path.transform(mirrorAcross(size.width))
        }
        return Outline.Generic(path)
    }

    companion object {
        private val none = SpeechBubbleShape(BubbleTail.NONE)
        private val leading = SpeechBubbleShape(BubbleTail.LEADING)
        private val trailing = SpeechBubbleShape(BubbleTail.TRAILING)

        fun of(tail: BubbleTail): SpeechBubbleShape = when (tail) {
            BubbleTail.NONE -> none
            BubbleTail.LEADING -> leading
            BubbleTail.TRAILING -> trailing
        }
    }
}

object SpeechBubble {
    val CORNER_RADIUS: Dp = 22.dp

    internal const val CAP_RADIUS = 179f
    internal const val TAIL_DROP = 68f
    internal const val ORIGIN_X = 766.342f
    internal const val ORIGIN_Y = 361.317f

    fun tailDrop(cornerRadius: Dp = CORNER_RADIUS): Dp =
        cornerRadius / CAP_RADIUS * TAIL_DROP

    internal val TAIL: FloatArray = floatArrayOf(
        766.342f, 249.767f, 727.342f, 299.817f, 699.842f, 323.317f,
        699.842f, 323.317f, 677.085f, 338.817f, 674.342f, 354.817f,
        668.342f, 389.817f, 700.829f, 410.817f, 691.829f, 421.317f,
        684.629f, 429.717f, 615.056f, 378.235f, 580.342f, 361.317f,
    )
}

private fun trailingTailPath(size: Size, radius: Float): Path {
    val width = size.width
    val height = size.height
    val diameter = radius * 2f
    val curves = tailCurves(width, height, radius)

    val path = Path()
    path.moveTo(radius, 0f)
    path.lineTo(width - radius, 0f)
    path.arcTo(Rect(width - diameter, 0f, width, diameter), TOP, QUARTER, false)
    path.lineTo(width, height - radius)
    var index = 0
    while (index < curves.size) {
        path.cubicTo(
            curves[index], curves[index + 1],
            curves[index + 2], curves[index + 3],
            curves[index + 4], curves[index + 5],
        )
        index += 6
    }
    path.lineTo(radius, height)
    path.arcTo(Rect(0f, height - diameter, diameter, height), BOTTOM, QUARTER, false)
    path.lineTo(0f, radius)
    path.arcTo(Rect(0f, 0f, diameter, diameter), LEADING_EDGE, QUARTER, false)
    path.close()
    return path
}

internal fun tailCurves(width: Float, height: Float, radius: Float): FloatArray {
    val scale = radius / SpeechBubble.CAP_RADIUS
    val out = FloatArray(SpeechBubble.TAIL.size)
    var index = 0
    while (index < out.size) {
        out[index] = width + (SpeechBubble.TAIL[index] - SpeechBubble.ORIGIN_X) * scale
        out[index + 1] = height + (SpeechBubble.TAIL[index + 1] - SpeechBubble.ORIGIN_Y) * scale
        index += 2
    }
    return out
}

internal fun mirrorAcross(width: Float): Matrix {
    val matrix = Matrix()
    matrix.translate(x = width)
    matrix.scale(x = -1f)
    return matrix
}

private const val TOP = -90f
private const val BOTTOM = 90f
private const val LEADING_EDGE = 180f
private const val QUARTER = 90f

object BubbleColor {
    val mine: Color = Color(MausPalette.argb("blue"))
    val mineText: Color = Color.White

    private val theirsDark = Color(0xFF262629)
    private val theirsLight = Color(0xFFE9E9EB)

    val theirs: Color
        @Composable get() =
            if (MaterialTheme.colorScheme.surface.luminance() < 0.5f) theirsDark else theirsLight
}
