// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.core

import java.util.Locale
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DictationTest {
    @Test
    fun emptyComposerTakesTheTranscript() {
        assertEquals("hello", Dictation.draft(base = "", transcript = "hello"))
    }

    @Test
    fun emptyTranscriptLeavesTheBase() {
        assertEquals("please look", Dictation.draft(base = "please look", transcript = ""))
        assertEquals("please look", Dictation.draft(base = "please look", transcript = "   "))
    }

    @Test
    fun spokenTextAppendsAfterTypedText() {
        assertEquals(
            "please look at the logs",
            Dictation.draft(base = "please", transcript = "look at the logs"),
        )
    }

    @Test
    fun whitespaceAroundEitherSideIsTrimmed() {
        assertEquals(
            "please look",
            Dictation.draft(base = "  please  ", transcript = "  look  "),
        )
    }

    @Test
    fun aLaterPartialReplacesAnEarlierOne() {
        val base = "please"
        assertEquals("please look", Dictation.draft(base = base, transcript = "look"))
        assertEquals(
            "please look at the logs",
            Dictation.draft(base = base, transcript = "look at the logs"),
        )
    }

    @Test
    fun bothEmptyStaysEmpty() {
        assertEquals("", Dictation.draft(base = "", transcript = ""))
        assertEquals("", Dictation.draft(base = "  ", transcript = "\n"))
    }


    @Test
    fun emptyTranscriptTakesTheNewPartial() {
        assertEquals("hello", Dictation.updateTranscript("", "hello"))
    }

    @Test
    fun emptyPartialLeavesTheTranscript() {
        assertEquals("hello", Dictation.updateTranscript("hello", ""))
        assertEquals("hello", Dictation.updateTranscript("hello", "   "))
    }

    @Test
    fun aLongerPartialReplacesTheCurrentOne() {
        assertEquals(
            "first sentence",
            Dictation.updateTranscript("first sent", "first sentence"),
        )
        assertEquals(
            "first sentence.",
            Dictation.updateTranscript("first sentence", "first sentence."),
        )
    }

    @Test
    fun aFreshSegmentIsAppendedAfterThePreviousText() {
        assertEquals(
            "first sentence. second sentence.",
            Dictation.updateTranscript("first sentence.", "second sentence."),
        )
    }

    @Test
    fun aWordLevelRevisionReplacesInPlace() {
        assertEquals(
            "I walked to a store",
            Dictation.updateTranscript("I walked to the store", "I walked to a store"),
        )
    }

    @Test
    fun aBacktrackKeepsTheLongerTranscript() {
        assertEquals(
            "first sentence",
            Dictation.updateTranscript("first sentence", "first"),
        )
    }

    @Test
    fun aSharedFirstWordIsNotEnoughToMergeAcrossSegments() {
        assertEquals(
            "first sentence first word",
            Dictation.updateTranscript("first sentence", "first word"),
        )
    }

    @Test
    fun preferredLanguageComesFirst() {
        val locales = Dictation.localeCandidates(
            preferredLanguages = listOf("fr-FR", "de-DE"),
            current = Locale.forLanguageTag("en-US"),
        )
        assertEquals("fr_fr", Dictation.canonicalIdentifier(locales[0]))
        assertTrue(locales.map(Dictation::canonicalIdentifier).contains("en_us"))
    }

    @Test
    fun englishIsNotDuplicatedWhenItIsAlreadyPreferred() {
        val locales = Dictation.localeCandidates(
            preferredLanguages = listOf("en-US"),
            current = Locale.forLanguageTag("en-US"),
        )
        assertEquals(listOf("en_us"), locales.map(Dictation::canonicalIdentifier))
    }

    @Test
    fun hyphenAndUnderscoreAreTheSameCandidate() {
        val locales = Dictation.localeCandidates(
            preferredLanguages = listOf("en-US"),
            current = Dictation.localeFromTag("en_US"),
        )
        assertEquals(listOf("en_us"), locales.map(Dictation::canonicalIdentifier))
    }

    @Test
    fun englishIsTheLastResortWhenNothingElseIsOffered() {
        val locales = Dictation.localeCandidates(
            preferredLanguages = emptyList(),
            current = Locale.forLanguageTag("ja-JP"),
        )
        assertEquals("ja_jp", Dictation.canonicalIdentifier(locales[0]))
        assertEquals("en_us", locales.last().let(Dictation::canonicalIdentifier))
    }

    @Test
    fun preferredLanguageProbingIsBounded() {
        val locales = Dictation.localeCandidates(
            preferredLanguages = listOf("fr-FR", "de-DE", "it-IT", "es-ES", "pt-BR"),
            current = Locale.forLanguageTag("ja-JP"),
        )
        val keys = locales.map(Dictation::canonicalIdentifier)
        assertEquals(listOf("fr_fr", "de_de", "it_it"), keys.take(3))
        assertFalse(keys.contains("es_es"))
        assertFalse(keys.contains("pt_br"))
        assertEquals(listOf("ja_jp", "en_us"), keys.takeLast(2))
    }


    @Test
    fun typedTextSurvivesRecreationThroughTheSnapshot() {
        var provenance = DraftProvenance()
        provenance = Dictation.afterTypedEdit(provenance, "please look at the logs")
        assertEquals("please look at the logs", provenance.typedSnapshot)
        assertFalse(provenance.contaminated)

        val restored = Dictation.seedVolatileDraft(
            held = null,
            typedSnapshot = Dictation.restoredDraft(provenance),
        )
        assertEquals("please look at the logs", restored.text)
        assertFalse(restored.contaminated)
    }

    @Test
    fun dictatedTextDoesNotSurviveRecreation() {
        var provenance = DraftProvenance()
        provenance = Dictation.afterTypedEdit(provenance, "please")
        val live = Dictation.draft(base = "please", transcript = "look at the logs")
        provenance = Dictation.afterDictation(provenance)

        assertEquals("please look at the logs", live)
        assertEquals("please", provenance.typedSnapshot)
        assertTrue(provenance.contaminated)

        val restored = Dictation.seedVolatileDraft(
            held = null,
            typedSnapshot = Dictation.restoredDraft(provenance),
        )
        assertEquals("please", restored.text)
        assertFalse(restored.contaminated)
        assertFalse(restored.text.contains("look at the logs"))
    }

    @Test
    fun editAfterDictationDoesNotSmuggleSpeechIntoTheSnapshot() {
        var provenance = DraftProvenance()
        provenance = Dictation.afterTypedEdit(provenance, "please")
        var live = Dictation.draft(base = "please", transcript = "look")
        provenance = Dictation.afterDictation(provenance)

        live = "$live at the logs!"
        provenance = Dictation.afterTypedEdit(provenance, live)

        assertEquals("please look at the logs!", live)
        assertEquals("please", provenance.typedSnapshot)
        assertTrue(provenance.contaminated)

        val restored = Dictation.seedVolatileDraft(
            held = null,
            typedSnapshot = Dictation.restoredDraft(provenance),
        )
        assertEquals("please", restored.text)
        assertFalse(restored.text.contains("look"))
    }

    @Test
    fun sendOrClearResetsProvenance() {
        var provenance = Dictation.afterDictation(
            Dictation.afterTypedEdit(DraftProvenance(), "please"),
        )
        assertTrue(provenance.contaminated)
        assertEquals("please", provenance.typedSnapshot)

        provenance = Dictation.afterClear()
        assertEquals(DraftProvenance(), provenance)

        provenance = Dictation.afterTypedEdit(provenance, "new draft")
        assertEquals("new draft", provenance.typedSnapshot)
        assertFalse(provenance.contaminated)
    }

    @Test
    fun emptyingTheFieldResetsProvenance() {
        var provenance = Dictation.afterDictation(
            Dictation.afterTypedEdit(DraftProvenance(), "please"),
        )
        assertTrue(provenance.contaminated)
        assertEquals("please", provenance.typedSnapshot)

        provenance = Dictation.afterTypedEdit(provenance, "")
        assertEquals(DraftProvenance(), provenance)
    }

    @Test
    fun seedPrefersHeldVolatileOverTypedSnapshot() {
        val held = VolatileDraft(
            text = "please look at the logs",
            contaminated = true,
        )
        val seeded = Dictation.seedVolatileDraft(
            held = held,
            typedSnapshot = "please",
        )
        assertEquals("please look at the logs", seeded.text)
        assertTrue(seeded.contaminated)
    }
}
