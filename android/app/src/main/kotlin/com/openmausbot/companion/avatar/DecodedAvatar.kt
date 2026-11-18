// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.avatar

import android.graphics.Bitmap

class DecodedAvatar private constructor(
    private val bitmap: Bitmap?,
    val byteCost: Int,
) {
    fun asBitmap(): Bitmap? = bitmap

    companion object {
        fun fromBitmap(bitmap: Bitmap): DecodedAvatar =
            DecodedAvatar(
                bitmap = bitmap,
                byteCost = bitmap.allocationByteCount.coerceAtLeast(0),
            )

        fun forTest(byteCost: Int): DecodedAvatar =
            DecodedAvatar(bitmap = null, byteCost = byteCost.coerceAtLeast(0))
    }
}
