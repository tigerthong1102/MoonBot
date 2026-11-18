// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.avatar

import com.openmausbot.companion.core.AvatarCrop
import java.io.ByteArrayOutputStream
import java.io.InputStream
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.yield

object AvatarImageRules {
    const val MAX_BYTES: Int = 10 * 1_024 * 1_024

    const val TYPE_ERROR: String = "Choose a PNG, JPEG, GIF, or WebP image."
    const val SIZE_ERROR: String = "That image is larger than 10 MB."

    fun imageMime(data: ByteArray): String? {
        if (data.size >= 4 &&
            data[0] == 0x89.toByte() &&
            data[1] == 0x50.toByte() &&
            data[2] == 0x4e.toByte() &&
            data[3] == 0x47.toByte()
        ) {
            return "image/png"
        }
        if (data.size >= 3 &&
            data[0] == 0xff.toByte() &&
            data[1] == 0xd8.toByte() &&
            data[2] == 0xff.toByte()
        ) {
            return "image/jpeg"
        }
        if (data.size >= 4 &&
            data[0] == 'G'.code.toByte() &&
            data[1] == 'I'.code.toByte() &&
            data[2] == 'F'.code.toByte() &&
            data[3] == '8'.code.toByte()
        ) {
            return "image/gif"
        }
        if (data.size >= 12 &&
            data[0] == 'R'.code.toByte() &&
            data[1] == 'I'.code.toByte() &&
            data[2] == 'F'.code.toByte() &&
            data[3] == 'F'.code.toByte() &&
            data[8] == 'W'.code.toByte() &&
            data[9] == 'E'.code.toByte() &&
            data[10] == 'B'.code.toByte() &&
            data[11] == 'P'.code.toByte()
        ) {
            return "image/webp"
        }
        return null
    }

    fun prepare(data: ByteArray): PreparedAvatar {
        val mime = imageMime(data) ?: return PreparedAvatar.Rejected(TYPE_ERROR)
        if (data.size > MAX_BYTES) return PreparedAvatar.Rejected(SIZE_ERROR)
        return PreparedAvatar.Ready(data = data, mime = mime)
    }

    suspend fun prepare(stream: InputStream, capacityHint: Long? = null): PreparedAvatar {
        val initial = capacityHint
            ?.takeIf { it > 0 }
            ?.toInt()
            ?.coerceAtMost(MAX_BYTES)
            ?: (16 * 1024)
        val buffer = ByteArrayOutputStream(initial.coerceAtLeast(16 * 1024))
        val chunk = ByteArray(16 * 1024)
        var total = 0
        while (true) {
            yield()
            coroutineContext.ensureActive()
            val space = (MAX_BYTES + 1) - total
            if (space <= 0) break
            val read = stream.read(chunk, 0, minOf(chunk.size, space))
            if (read < 0) break
            total += read
            buffer.write(chunk, 0, read)
        }
        return prepare(buffer.toByteArray())
    }

    fun intendedUploadCrop(selected: AvatarCrop): AvatarCrop =
        if (selected == AvatarCrop.MASCOT) AvatarCrop.CIRCLE else selected

    fun usesImage(crop: AvatarCrop, avatarUrl: String?, failed: Boolean): Boolean =
        crop != AvatarCrop.MASCOT && avatarUrl != null && !failed

    fun roundedCornerRadius(size: Float): Float = size * ROUNDED_CORNER_FRACTION

    const val ROUNDED_CORNER_FRACTION: Float = 0.22f
}

sealed class PreparedAvatar {
    data class Ready(val data: ByteArray, val mime: String) : PreparedAvatar() {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (other !is Ready) return false
            return mime == other.mime && data.contentEquals(other.data)
        }

        override fun hashCode(): Int = 31 * mime.hashCode() + data.contentHashCode()
    }

    data class Rejected(val message: String) : PreparedAvatar()
}
