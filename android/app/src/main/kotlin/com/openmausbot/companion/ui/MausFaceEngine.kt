// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import kotlin.math.PI
import kotlin.math.max
import kotlin.math.sin
import kotlin.random.Random


internal class MausFaceEngine(private val random: Random = Random.Default) {
    var state: MausState = MausState.IDLE
        private set

    var motion: MausBodyMotion = MausBodyMotion()
        private set

    private var expression = 0
    private val currentRings = Array(EYES) { FloatArray(MausFaceData.RING_STRIDE) }
    private val targetRings = Array(EYES) { FloatArray(MausFaceData.RING_STRIDE) }
    private val displayedRings = Array(EYES) { FloatArray(MausFaceData.RING_STRIDE) }
    private val currentMouth = FloatArray(MausFaceData.MOUTH_STRIDE)
    private val targetMouth = FloatArray(MausFaceData.MOUTH_STRIDE)
    private val displayedMouth = FloatArray(MausFaceData.MOUTH_STRIDE)
    private var currentGazeX = MausFaceData.gazeX(0)
    private var currentGazeY = MausFaceData.gazeY(0)
    private var targetGazeX = currentGazeX
    private var targetGazeY = currentGazeY

    private var morph = 1f
    private var velocity = 0f
    private var blinkStartNanos = UNSET
    private var nextExpressionAtNanos = UNSET
    private var nextBlinkAtNanos = UNSET
    private var stateStartNanos = 0L
    private var lastNanos = UNSET
    private var started = false

    init {
        for (eye in 0 until EYES) {
            MausFaceData.copyRing(0, eye, currentRings[eye])
            MausFaceData.copyRing(0, eye, targetRings[eye])
        }
        MausFaceData.copyMouth(0, currentMouth)
        MausFaceData.copyMouth(0, targetMouth)
    }

    fun setState(next: MausState, nowNanos: Long) {
        if (started && next == state) return
        started = true
        state = next
        stateStartNanos = nowNanos
        motion = MausFaceData.motion[next] ?: MausBodyMotion()
        select(MausFaceData.pools[next]?.firstOrNull() ?: 0)
        if (lastNanos == UNSET) {
            morph = 1f
            velocity = 0f
        }
        nextExpressionAtNanos = schedule(MausFaceData.expressionCadence[next], nowNanos)
        nextBlinkAtNanos = schedule(MausFaceData.blink[next], nowNanos)
    }

    fun advance(nowNanos: Long) {
        val dt = if (lastNanos == UNSET) 0f else ((nowNanos - lastNanos) / NANOS_PER_SECOND).coerceIn(0f, 0.1f)
        lastNanos = nowNanos

        velocity += (-2f * SPRING * velocity - SPRING * SPRING * (morph - 1f)) * dt
        morph += velocity * dt
        if (!morph.isFinite()) {
            morph = 1f
            velocity = 0f
        }

        if (nextExpressionAtNanos != UNSET && nowNanos >= nextExpressionAtNanos) {
            select(nextExpression())
            nextExpressionAtNanos = schedule(MausFaceData.expressionCadence[state], nowNanos)
        }
        if (nextBlinkAtNanos != UNSET && nowNanos >= nextBlinkAtNanos) {
            blinkStartNanos = nowNanos
            nextBlinkAtNanos = schedule(MausFaceData.blink[state], nowNanos)
        }
    }

    fun rest() {
        morph = 1f
        velocity = 0f
        blinkStartNanos = UNSET
    }

    fun ring(eye: Int): FloatArray {
        val m = morph.coerceIn(0f, 1f)
        val current = currentRings[eye]
        val target = targetRings[eye]
        val out = displayedRings[eye]
        val offsetX = gazeX() * LOOK_AROUND
        val offsetY = gazeY() * LOOK_AROUND
        var i = 0
        while (i < out.size) {
            out[i] = current[i] + (target[i] - current[i]) * m + offsetX
            out[i + 1] = current[i + 1] + (target[i + 1] - current[i + 1]) * m + offsetY
            i += 2
        }
        return out
    }

    fun mouth(): FloatArray {
        val m = morph.coerceIn(0f, 1f)
        for (i in displayedMouth.indices) {
            displayedMouth[i] = currentMouth[i] + (targetMouth[i] - currentMouth[i]) * m
        }
        return displayedMouth
    }

    fun blinkScale(nowNanos: Long): Float {
        if (blinkStartNanos == UNSET) return 1f
        val t = (nowNanos - blinkStartNanos) / NANOS_PER_SECOND / BLINK_SECONDS
        if (t >= 1f) {
            blinkStartNanos = UNSET
            return 1f
        }
        return max(if (t < 0.42f) 1f - t / 0.42f else (t - 0.42f) / 0.58f, 0.04f)
    }

    fun elapsedMillis(nowNanos: Long): Float = (nowNanos - stateStartNanos) / NANOS_PER_MILLI

    private fun gazeX(): Float {
        val m = morph.coerceIn(0f, 1f)
        return currentGazeX + (targetGazeX - currentGazeX) * m
    }

    private fun gazeY(): Float {
        val m = morph.coerceIn(0f, 1f)
        return currentGazeY + (targetGazeY - currentGazeY) * m
    }

    private fun select(index: Int) {
        val count = MausFaceData.EXPRESSION_COUNT
        val next = ((index % count) + count) % count
        if (next == expression && morph >= 1f) return

        val m = morph.coerceIn(0f, 1f)
        for (eye in 0 until EYES) {
            val current = currentRings[eye]
            val target = targetRings[eye]
            for (i in current.indices) current[i] += (target[i] - current[i]) * m
            MausFaceData.copyRing(next, eye, target)
        }
        for (i in currentMouth.indices) currentMouth[i] += (targetMouth[i] - currentMouth[i]) * m
        MausFaceData.copyMouth(next, targetMouth)
        currentGazeX = gazeX()
        currentGazeY = gazeY()
        targetGazeX = MausFaceData.gazeX(next)
        targetGazeY = MausFaceData.gazeY(next)

        expression = next
        morph = 0f
        velocity = 0f
    }

    private fun nextExpression(): Int {
        val pool = MausFaceData.pools[state] ?: return 0
        var alternatives = 0
        for (index in pool.indices) {
            if (pool[index] != expression) alternatives++
        }
        if (alternatives == 0) return pool[0]
        var remaining = random.nextInt(alternatives)
        for (index in pool.indices) {
            val candidate = pool[index]
            if (candidate == expression) continue
            if (remaining == 0) return candidate
            remaining--
        }
        return pool[0]
    }

    private fun schedule(range: MausRange?, nowNanos: Long): Long {
        if (range == null) return UNSET
        val millis = range.minMillis + random.nextFloat() * (range.maxMillis - range.minMillis)
        return nowNanos + (millis * NANOS_PER_MILLI).toLong()
    }

    companion object {
        const val LOOK_AROUND = 0.35f

        private const val EYES = 2
        private const val SPRING = 7f
        private const val BLINK_SECONDS = 0.320f
        private const val NANOS_PER_SECOND = 1_000_000_000f
        private const val NANOS_PER_MILLI = 1_000_000f
        private const val UNSET = Long.MIN_VALUE
    }
}

internal class MausBodyPose {
    var dx: Float = 0f
    var dy: Float = 0f
    var rotationDegrees: Float = 0f
    var scale: Float = 1f
    var squashX: Float = 1f
    var squashY: Float = 1f
}

internal fun MausBodyMotion.poseAt(elapsedMillis: Float, out: MausBodyPose) {
    out.dx = 0f
    out.dy = 0f
    out.rotationDegrees = tilt ?: 0f
    out.scale = 1f
    out.squashX = 1f
    out.squashY = 1f

    bob?.let { motion ->
        val phase = wave(elapsedMillis, motion.periodMillis)
        out.dy -= motion.amplitude * phase
        squash?.let { amount ->
            val landing = amount * max(0f, -phase)
            out.squashY = 1f - landing * 0.5f
            out.squashX = 1f + landing * 0.5f
        }
    }
    circle?.let {
        out.dx += it.amplitude * wave(elapsedMillis, it.periodMillis)
        out.dy += it.amplitude * wave(elapsedMillis, it.periodMillis, QUARTER_TURN)
    }
    sway?.let { out.rotationDegrees += it.amplitude * wave(elapsedMillis, it.periodMillis) }
    pulse?.let { out.scale *= 1f + it.amplitude * wave(elapsedMillis, it.periodMillis) }
    jitter?.let {
        out.dx += it.amplitude * wave(elapsedMillis, it.periodMillis)
        out.dy += it.amplitude * wave(elapsedMillis, it.periodMillis * 0.63f, 1.1f)
    }
    enter?.let {
        val t = elapsedMillis / it.durationMillis
        out.scale *= if (t >= 1f) 1f else it.from + (1f - it.from) * easeOutBack(max(t, 0f))
    }
    settle?.let {
        val t = (elapsedMillis / 1400f).coerceIn(0f, 1f)
        out.scale *= 1f + (it - 1f) * easeInOut(t)
    }
}

private val QUARTER_TURN = (PI / 2).toFloat()

private fun wave(elapsedMillis: Float, periodMillis: Float, phase: Float = 0f): Float =
    sin(elapsedMillis / periodMillis * 2f * PI.toFloat() + phase)

private fun easeOutBack(t: Float): Float {
    val c = 1.7f
    val u = t - 1f
    return 1f + (c + 1f) * u * u * u + c * u * u
}

private fun easeInOut(t: Float): Float = if (t < 0.5f) 2f * t * t else 1f - 2f * (1f - t) * (1f - t)
