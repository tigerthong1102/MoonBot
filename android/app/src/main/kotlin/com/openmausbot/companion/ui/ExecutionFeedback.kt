// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import com.openmausbot.companion.core.ActivityDetail
import kotlin.math.PI
import kotlin.math.cos


enum class TranscriptTail {
    STREAM,

    REASONING,

    WORKING,

    NONE,
}

object LiveTail {
    fun of(
        streaming: String?, reasoning: String?, busy: Boolean,
        detail: ActivityDetail = ActivityDetail.FULL,
    ): TranscriptTail = when {
        !streaming.isNullOrEmpty() -> TranscriptTail.STREAM
        detail != ActivityDetail.HIDDEN && !reasoning.isNullOrEmpty() -> TranscriptTail.REASONING
        busy -> TranscriptTail.WORKING
        else -> TranscriptTail.NONE
    }

    fun workingLabel(name: String): String = "$name is working"
}

object WorkingDots {
    const val COUNT: Int = 3

    const val REST_ALPHA: Float = 0.6f

    const val MIN_ALPHA: Float = 0.3f
    const val MAX_ALPHA: Float = 1f

    const val PERIOD_NANOS: Long = 1_100_000_000L

    const val PHASE_STEP: Float = 0.2f

    private const val TWO_PI: Float = (2.0 * PI).toFloat()

    fun alpha(index: Int, elapsedNanos: Long, moving: Boolean): Float {
        if (!moving) return REST_ALPHA
        val cycle = (elapsedNanos % PERIOD_NANOS).toFloat() / PERIOD_NANOS
        val wave = (1f - cos((cycle - index * PHASE_STEP) * TWO_PI)) * 0.5f
        return MIN_ALPHA + wave * (MAX_ALPHA - MIN_ALPHA)
    }
}

enum class ActivityStatus { RUNNING, SUCCESS, ERROR }

object ActivityReceipt {
    fun status(ok: Boolean?): ActivityStatus = when (ok) {
        null -> ActivityStatus.RUNNING
        true -> ActivityStatus.SUCCESS
        false -> ActivityStatus.ERROR
    }

    fun label(status: ActivityStatus): String = when (status) {
        ActivityStatus.RUNNING -> "Running"
        ActivityStatus.SUCCESS -> "Success"
        ActivityStatus.ERROR -> "Error"
    }

    fun showsLabel(status: ActivityStatus): Boolean = status != ActivityStatus.SUCCESS

    fun announcement(name: String, status: ActivityStatus): String =
        "$name, ${label(status).lowercase()}"
}
