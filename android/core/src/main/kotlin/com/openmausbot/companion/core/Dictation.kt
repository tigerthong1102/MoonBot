// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.core

import java.util.Locale

data class DraftProvenance(
    val typedSnapshot: String = "",
    val contaminated: Boolean = false,
)

data class VolatileDraft(
    val text: String = "",
    val contaminated: Boolean = false,
)

object Dictation {
    private const val MAXIMUM_PREFERRED_LANGUAGES = 3

    fun draft(base: String, transcript: String): String {
        val typed = base.trim()
        val spoken = transcript.trim()
        if (spoken.isEmpty()) return typed
        if (typed.isEmpty()) return spoken
        return "$typed $spoken"
    }

    fun updateTranscript(current: String, new: String): String {
        val current = current.trim()
        val new = new.trim()
        if (new.isEmpty()) return current
        if (current.isEmpty()) return new

        if (new.startsWith(current)) return new

        if (current.startsWith(new)) return current

        val currentWords = current.split(" ").filter { it.isNotEmpty() }
        val newWords = new.split(" ").filter { it.isNotEmpty() }
        val commonWordCount = currentWords
            .zip(newWords)
            .takeWhile { it.first.lowercase() == it.second.lowercase() }
            .count()
        if (commonWordCount >= 2 && commonWordCount * 2 >= currentWords.size) {
            return new
        }

        return draft(base = current, transcript = new)
    }

    fun afterTypedEdit(provenance: DraftProvenance, draft: String): DraftProvenance =
        when {
            draft.isEmpty() -> afterClear()
            provenance.contaminated -> provenance
            else -> provenance.copy(typedSnapshot = draft)
        }

    fun afterDictation(provenance: DraftProvenance): DraftProvenance =
        provenance.copy(contaminated = true)

    fun afterClear(): DraftProvenance = DraftProvenance()

    fun restoredDraft(provenance: DraftProvenance): String = provenance.typedSnapshot

    fun seedVolatileDraft(held: VolatileDraft?, typedSnapshot: String): VolatileDraft =
        held ?: VolatileDraft(text = typedSnapshot, contaminated = false)

    fun localeCandidates(
        preferredLanguages: List<String>,
        current: Locale = Locale.getDefault(),
    ): List<Locale> {
        val seen = linkedSetOf<String>()
        val result = ArrayList<Locale>()
        fun add(locale: Locale) {
            val key = canonicalIdentifier(locale)
            if (key.isEmpty()) return
            if (!seen.add(key)) return
            result += locale
        }
        for (language in preferredLanguages.take(MAXIMUM_PREFERRED_LANGUAGES)) {
            add(localeFromTag(language))
        }
        add(current)
        add(localeFromTag("en-US"))
        return result
    }

    fun canonicalIdentifier(locale: Locale): String =
        locale.toLanguageTag().lowercase().replace('-', '_')

    fun localeFromTag(tag: String): Locale =
        Locale.forLanguageTag(tag.trim().replace('_', '-'))
}
