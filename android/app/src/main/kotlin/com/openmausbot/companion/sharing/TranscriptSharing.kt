// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.sharing

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.openmausbot.companion.core.ExportedTranscript
import com.openmausbot.companion.ui.ShareFormat
import com.openmausbot.companion.ui.SharePayload
import java.io.File

class TranscriptSharing(
    private val context: Context,
    private val authority: String = "${context.packageName}.transcripts",
) {
    fun share(export: ExportedTranscript, format: ShareFormat): String? {
        val directory = File(context.cacheDir, DIRECTORY)
        return try {
            clearPrevious(directory)
            if (!directory.exists() && !directory.mkdirs()) {
                return "Could not prepare the transcript for sharing."
            }
            val file = File(directory, SharePayload.fileName(export, format))
            file.writeBytes(export.data)

            val uri = FileProvider.getUriForFile(context, authority, file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = SharePayload.mimeType(export, format)
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_TITLE, file.name)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(send, SharePayload.chooserTitle(format)).apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                if (context !is android.app.Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(chooser)
            null
        } catch (error: Exception) {
            "Could not share the transcript: ${error.message ?: error::class.simpleName}"
        }
    }

    private fun clearPrevious(directory: File) {
        directory.listFiles()?.forEach { runCatching { it.delete() } }
    }

    private companion object {
        const val DIRECTORY = "shared-transcripts"
    }
}
