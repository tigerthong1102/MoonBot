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

/**
 * Image selection for an agent avatar.
 *
 * **minSdk 26 decision:** use AndroidX `PickVisualMedia` with `ImageOnly`.
 * - API 33+: system Photo Picker (no storage permission).
 * - API 26–32: AndroidX falls back to the Storage Access Framework
 *   (`ACTION_OPEN_DOCUMENT`) with the same image-only filter — still no
 *   `READ_EXTERNAL_STORAGE` / `READ_MEDIA_IMAGES`. The user grants access to
 *   one URI; the app never browses the gallery itself.
 *
 * Do not register a second permission owner for this path: picking an image
 * does not go through [com.openmausbot.companion.permissions.CompanionPermissions].
 *
 * [read] is suspending: query + body I/O run on [Dispatchers.IO], cooperate
 * with cancellation (closing the stream as soon as the job is cancelled,
 * including while a provider [InputStream.read] is blocked), and never block
 * the main thread the way an `ActivityResult` callback otherwise would.
 */
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
