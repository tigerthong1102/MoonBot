// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.avatar

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import java.io.InputStream
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** AndroidX PickVisualMedia uses the system Photo Picker on API 33+ and ACTION_OPEN_DOCUMENT on older versions; neither requires broad storage access. */
object AvatarImagePicker {
    fun contract(): ActivityResultContracts.PickVisualMedia =
        ActivityResultContracts.PickVisualMedia()

    fun request(): PickVisualMediaRequest =
        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)

    suspend fun read(resolver: ContentResolver, uri: Uri): PreparedAvatar =
        withContext(Dispatchers.IO) {
            coroutineContext.ensureActive()
            val capacityHint = declaredSize(resolver, uri)
            val stream = try {
                resolver.openInputStream(uri)
            } catch (_: Exception) {
                null
            } ?: return@withContext PreparedAvatar.Rejected(AvatarImageRules.TYPE_ERROR)

            try {
                withStreamClosedOnCancel(stream) {
                    AvatarImageRules.prepare(stream, capacityHint = capacityHint)
                }
            } catch (error: kotlinx.coroutines.CancellationException) {
                throw error
            } catch (_: Exception) {
                coroutineContext.ensureActive()
                PreparedAvatar.Rejected(AvatarImageRules.TYPE_ERROR)
            } finally {
                runCatching { stream.close() }
            }
        }

    private fun declaredSize(resolver: ContentResolver, uri: Uri): Long? {
        return try {
            resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                val index = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (index < 0 || !cursor.moveToFirst() || cursor.isNull(index)) null
                else cursor.getLong(index).takeIf { it >= 0 }
            }
        } catch (_: Exception) {
            null
        }
    }
}

internal suspend fun <T> withStreamClosedOnCancel(
    stream: InputStream,
    block: suspend () -> T,
): T = coroutineScope {
    val closer = launch(start = CoroutineStart.UNDISPATCHED) {
        try {
            awaitCancellation()
        } finally {
            runCatching { stream.close() }
        }
    }
    try {
        val result = block()
        coroutineContext.ensureActive()
        result
    } finally {
        closer.cancel()
    }
}
