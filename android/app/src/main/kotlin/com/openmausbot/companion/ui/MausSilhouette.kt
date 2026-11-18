// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Matrix
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.vector.PathParser

internal object MausSilhouette {
    const val FACE_MARGIN: Float = 15f

    const val FACE_BOX: Float = MausFaceData.FACE_BOX

    val defaultBody: String get() = MausBodies.DEFAULT_ID

    data class Anchor(val x: Float, val y: Float, val scale: Float)

    private class Placed(val path: Path, val bounds: Rect, val anchor: Anchor)

    private val cache = HashMap<String, Placed>()
    private val lock = Any()

    fun inFaceBox(id: String?): Path = placed(id).path

    fun faceBoxBounds(id: String?): Rect = placed(id).bounds

    fun anchor(id: String?): Anchor = placed(id).anchor

    private fun placed(id: String?): Placed {
        val body = MausBodies.body(id)
        synchronized(lock) {
            cache[body.id]?.let { return it }
            val fit = Matrix().apply {
                this[0, 0] = body.fitScale
                this[1, 1] = body.fitScale
                this[3, 0] = body.fitTx
                this[3, 1] = body.fitTy
            }
            val path = parse(body.path).apply { transform(fit) }
            val placed = Placed(
                path = path,
                bounds = Rect(body.left, body.top, body.right, body.bottom),
                anchor = Anchor(body.anchorX, body.anchorY, body.anchorScale),
            )
            cache[body.id] = placed
            return placed
        }
    }

    /**
     * SVG path data into a [Path]. The catalog is absolute `M`, `C` and `Z` with
     * newlines as separators, all of which Compose's parser reads.
     */
    internal fun parse(data: String): Path = PathParser().parsePathString(data).toPath()
}
