// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import com.openmausbot.companion.core.ExportedTranscript

enum class ShareFormat(
    val wire: String,
    val label: String,
    val extension: String,
    val mime: String,
) {
    MARKDOWN("markdown", "Share as Markdown", "md", "text/markdown"),
    JSON("json", "Share as JSON", "json", "application/json"),
}

// Exported filenames and MIME types are untrusted; reject path traversal before sharing cached files.
object SharePayload {
    private const val MAX_NAME = 96
    private val SAFE_NAME = Regex("[^A-Za-z0-9._-]")
    private val MIME = Regex("^[A-Za-z0-9!#\$&^_.+-]+/[A-Za-z0-9!#\$&^_.+-]+$")

    fun fileName(export: ExportedTranscript, format: ShareFormat): String {
        val leaf = export.filename
            .substringAfterLast('/')
            .substringAfterLast('\\')
            .trim()
        val cleaned = SAFE_NAME.replace(leaf, "_")
            .trimStart('.')
            .take(MAX_NAME)
        if (cleaned.isEmpty()) return "transcript.${format.extension}"
        return if (cleaned.endsWith(".${format.extension}", ignoreCase = true)) {
            cleaned
        } else {
            "$cleaned.${format.extension}"
        }
    }

    fun mimeType(export: ExportedTranscript, format: ShareFormat): String {
        val declared = export.contentType.substringBefore(';').trim()
        return if (MIME.matches(declared)) declared else format.mime
    }

    fun chooserTitle(format: ShareFormat): String = format.label
}
