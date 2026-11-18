// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.MutableLongState
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt
import kotlinx.coroutines.flow.collectLatest

@Composable
internal fun MausAvatar(
    color: String,
    bodyId: String? = MausSilhouette.defaultBody,
    size: Dp = 52.dp,
    state: MausState = MausState.IDLE,
    animated: Boolean = true,
    modifier: Modifier = Modifier,
) {
    if (MausBodies.body(bodyId).id == MausBodies.DEFAULT_ID) {
        androidx.compose.foundation.Image(
            painter = androidx.compose.ui.res.painterResource(com.openmausbot.companion.R.drawable.startupbot_logo),
            contentDescription = null,
            modifier = modifier.size(size),
            contentScale = androidx.compose.ui.layout.ContentScale.Fit,
        )
        return
    }
    val engine = remember { MausFaceEngine() }
    val geometry = remember { MausFaceGeometry() }
    val clock = remember { MausFrameClock() }
    val body = remember(color, bodyId) {
        val bounds = MausSilhouette.faceBoxBounds(bodyId)
        Brush.linearGradient(
            colorStops = MausPalette.gradient(color)
                .map { (position, argb) -> position to Color(argb) }
                .toTypedArray(),
            start = Offset(bounds.right, bounds.top),
            end = Offset(bounds.left, bounds.bottom),
        )
    }

    var moving by remember { mutableStateOf(false) }
    var shown by remember { mutableStateOf(true) }

    LaunchedEffect(animated) {
        val durationScale = coroutineContext[MotionDurationScale]
        snapshotFlow { animated && shown && (durationScale?.scaleFactor ?: 1f) > 0f }
            .collectLatest { live ->
                moving = live
                if (!live) return@collectLatest
                while (true) withFrameNanos(clock.onFrame)
            }
    }

    Canvas(
        modifier = modifier
            .size(size)
            .onGloballyPositioned { shown = !it.boundsInWindow().isEmpty }
            .semantics { },
    ) {
        val now = clock.nanos.longValue
        val live = moving
        engine.setState(state, now)
        if (live) engine.advance(now) else engine.rest()
        drawMaus(engine, geometry, body, bodyId, live, now)
    }
}

@Composable
fun ProfileAvatar(name: String, size: Dp = 34.dp, modifier: Modifier = Modifier) {
    Box(modifier = modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(size)) {
            drawCircle(color = Color(MausPalette.argb("green")))
        }
        Text(
            text = name.trim().take(1).uppercase(),
            color = Color.White,
            fontSize = (size.value * 0.45f).sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

internal class MausFrameClock {
    val nanos: MutableLongState = mutableLongStateOf(0L)

    val onFrame: (Long) -> Unit = ::publish

    private var origin = NO_ORIGIN
    private var published = 0L

    private fun publish(now: Long) {
        if (origin == NO_ORIGIN) origin = now
        val elapsed = now - origin
        if (elapsed - published >= FRAME_INTERVAL_NANOS) {
            published = elapsed
            nanos.longValue = elapsed
        }
    }
}

private class MausFaceGeometry {
    val eyes: Array<Path> = arrayOf(Path(), Path())
    val mouth: Path = Path()
    val comet: Path = Path()
    val comets: MausCometField = MausCometField()
    val pose: MausBodyPose = MausBodyPose()

    val cometBrushes: Array<Brush> by lazy(LazyThreadSafetyMode.NONE) {
        Array(MausComets.colors.size) { index ->
            val palette = MausComets.colors[index]
            Brush.linearGradient(
                colorStops = arrayOf(
                    0f to Color(palette[0]),
                    0.52f to Color(palette[1]),
                    1f to Color(palette[2]).copy(alpha = 0.35f),
                ),
                start = Offset.Zero,
                end = Offset(1f, 0f),
            )
        }
    }
}

private val mouthStroke = Stroke(width = MausFaceData.MOUTH_STROKE, cap = StrokeCap.Round)

private fun DrawScope.drawMaus(
    engine: MausFaceEngine,
    geometry: MausFaceGeometry,
    body: Brush,
    bodyId: String?,
    live: Boolean,
    nowNanos: Long,
) {
    val box = MausFaceData.FACE_BOX + MausSilhouette.FACE_MARGIN * 2
    val fit = min(size.width, size.height) / box
    withTransform({
        translate((size.width - box * fit) / 2f, (size.height - box * fit) / 2f)
        scale(fit, fit, Offset.Zero)
        translate(MausSilhouette.FACE_MARGIN, MausSilhouette.FACE_MARGIN)
    }) {
        val centre = MausFaceData.FACE_BOX / 2f
        val elapsed = engine.elapsedMillis(nowNanos)
        val trail = MausComets.trails[engine.state]
        if (trail != null) {
            geometry.comets.update(trail, elapsed, centre, centre)
            drawComets(geometry, front = false)
        }

        val pose = geometry.pose
        if (live) engine.motion.poseAt(elapsed, pose)
        withTransform({
            if (trail != null) scale(trail.bodyScale, trail.bodyScale, Offset(centre, centre))
            if (live) {
                translate(pose.dx, pose.dy)
                rotate(pose.rotationDegrees, Offset(centre, centre))
                scale(pose.scale, pose.scale, Offset(centre, centre))
                scale(pose.squashX, pose.squashY, Offset(centre, MausFaceData.FACE_BOX))
            }
        }) {
            drawBody(engine, geometry, body, bodyId, nowNanos)
        }

        if (trail != null) drawComets(geometry, front = true)
    }
}

private fun DrawScope.drawBody(
    engine: MausFaceEngine,
    geometry: MausFaceGeometry,
    body: Brush,
    bodyId: String?,
    nowNanos: Long,
) {
    val silhouette = MausSilhouette.inFaceBox(bodyId)
    val anchor = MausSilhouette.anchor(bodyId)
    drawPath(silhouette, body)

    clipPath(silhouette) {
        withTransform({
            translate(anchor.x, anchor.y)
            scale(anchor.scale, anchor.scale, Offset.Zero)
            translate(-MausFaceData.FACE_CENTRE_X, -MausFaceData.FACE_CENTRE_Y)
        }) {
            val left = engine.ring(0)
            val right = engine.ring(1)
            val blink = engine.blinkScale(nowNanos)
            drawEye(left, geometry.eyes[0], blink)
            drawEye(right, geometry.eyes[1], blink)
            drawMouth(left, right, engine.mouth(), geometry.mouth)
        }
    }
}

private fun DrawScope.drawEye(ring: FloatArray, path: Path, blink: Float) {
    val axis = centreY(ring)
    path.reset()
    var index = 0
    while (index < ring.size) {
        val y = axis + (ring[index + 1] - axis) * blink
        if (index == 0) path.moveTo(ring[0], y) else path.lineTo(ring[index], y)
        index += 2
    }
    path.close()
    drawPath(path, Color.White)
}

private fun DrawScope.drawMouth(left: FloatArray, right: FloatArray, mouth: FloatArray, path: Path) {
    val leftX = centreX(left)
    val leftY = centreY(left)
    val rightX = centreX(right)
    val rightY = centreY(right)
    val theta = atan2(rightY - leftY, rightX - leftX)
    val halfHeight = max(halfHeight(left), halfHeight(right))
    val drop = halfHeight + mouth[MausFaceData.MOUTH_GAP]
    val originX = (leftX + rightX) / 2f - sin(theta) * drop
    val originY = (leftY + rightY) / 2f + cos(theta) * drop
    val angle = theta + mouth[MausFaceData.MOUTH_SKEW] * DEGREES_TO_RADIANS
    val cosAngle = cos(angle)
    val sinAngle = sin(angle)
    val halfWidth = mouth[MausFaceData.MOUTH_HALF_WIDTH]
    val curve = mouth[MausFaceData.MOUTH_CURVE]

    path.reset()
    path.moveTo(originX - halfWidth * cosAngle, originY - halfWidth * sinAngle)
    path.quadraticTo(
        originX - curve * sinAngle,
        originY + curve * cosAngle,
        originX + halfWidth * cosAngle,
        originY + halfWidth * sinAngle,
    )
    drawPath(path = path, color = Color.White, style = mouthStroke)
}

private fun DrawScope.drawComets(geometry: MausFaceGeometry, front: Boolean) {
    val field = geometry.comets
    for (index in 0 until field.count) {
        val piece = field.piece(index)
        if (piece.front != front) continue
        val axisX = piece.gradientEndX - piece.gradientStartX
        val axisY = piece.gradientEndY - piece.gradientStartY
        val span = axisX * axisX + axisY * axisY
        if (span < 1e-6f) continue

        val path = geometry.comet
        path.reset()
        for (point in 0 until piece.points) {
            val offsetX = piece.outline[point * 2] - piece.gradientStartX
            val offsetY = piece.outline[point * 2 + 1] - piece.gradientStartY
            val along = (offsetX * axisX + offsetY * axisY) / span
            val across = (offsetY * axisX - offsetX * axisY) / span
            if (point == 0) path.moveTo(along, across) else path.lineTo(along, across)
        }
        path.close()

        val length = sqrt(span)
        withTransform({
            translate(piece.gradientStartX, piece.gradientStartY)
            rotate(atan2(axisY, axisX) * DEGREES_PER_RADIAN, Offset.Zero)
            scale(length, length, Offset.Zero)
        }) {
            drawPath(path, geometry.cometBrushes[piece.colorIndex])
        }
    }
}

private fun centreX(ring: FloatArray): Float {
    var total = 0f
    var index = 0
    while (index < ring.size) {
        total += ring[index]
        index += 2
    }
    return total / (ring.size / 2)
}

private fun centreY(ring: FloatArray): Float {
    var total = 0f
    var index = 1
    while (index < ring.size) {
        total += ring[index]
        index += 2
    }
    return total / (ring.size / 2)
}

private fun halfHeight(ring: FloatArray): Float {
    var low = Float.MAX_VALUE
    var high = -Float.MAX_VALUE
    var index = 1
    while (index < ring.size) {
        if (ring[index] < low) low = ring[index]
        if (ring[index] > high) high = ring[index]
        index += 2
    }
    return (high - low) / 2f
}

private val DEGREES_TO_RADIANS = (PI / 180).toFloat()
private val DEGREES_PER_RADIAN = (180 / PI).toFloat()
private const val FRAME_INTERVAL_NANOS = 1_000_000_000L / 30
private const val NO_ORIGIN = Long.MIN_VALUE
