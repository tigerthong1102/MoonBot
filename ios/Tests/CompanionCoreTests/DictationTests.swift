// Modified for StartupBot; original copyright and license retained.
import XCTest
@testable import CompanionCore

final class DictationTests: XCTestCase {
    func testEmptyComposerTakesTheTranscript() {
        XCTAssertEqual(Dictation.draft(base: "", transcript: "hello"), "hello")
    }

    func testEmptyTranscriptLeavesTheBase() {
        XCTAssertEqual(Dictation.draft(base: "please look", transcript: ""), "please look")
        XCTAssertEqual(Dictation.draft(base: "please look", transcript: "   "), "please look")
    }

    func testSpokenTextAppendsAfterTypedText() {
        XCTAssertEqual(Dictation.draft(base: "please", transcript: "look at the logs"), "please look at the logs")
    }

    func testWhitespaceAroundEitherSideIsTrimmed() {
        XCTAssertEqual(Dictation.draft(base: "  please  ", transcript: "  look  "), "please look")
    }

    func testALaterPartialReplacesAnEarlierOne() {
        let base = "please"
        XCTAssertEqual(Dictation.draft(base: base, transcript: "look"), "please look")
        XCTAssertEqual(Dictation.draft(base: base, transcript: "look at the logs"), "please look at the logs")
    }

    func testBothEmptyStaysEmpty() {
        XCTAssertEqual(Dictation.draft(base: "", transcript: ""), "")
        XCTAssertEqual(Dictation.draft(base: "  ", transcript: "\n"), "")
    }


    func testEmptyTranscriptTakesTheNewPartial() {
        XCTAssertEqual(Dictation.updateTranscript("", new: "hello"), "hello")
    }

    func testEmptyPartialLeavesTheTranscript() {
        XCTAssertEqual(Dictation.updateTranscript("hello", new: ""), "hello")
        XCTAssertEqual(Dictation.updateTranscript("hello", new: "   "), "hello")
    }

    func testALongerPartialReplacesTheCurrentOne() {
        XCTAssertEqual(
            Dictation.updateTranscript("first sent", new: "first sentence"),
            "first sentence"
        )
        XCTAssertEqual(
            Dictation.updateTranscript("first sentence", new: "first sentence."),
            "first sentence."
        )
    }

    func testAFreshSegmentIsAppendedAfterThePreviousText() {
        XCTAssertEqual(
            Dictation.updateTranscript("first sentence.", new: "second sentence."),
            "first sentence. second sentence."
        )
    }

    func testAWordLevelRevisionReplacesInPlace() {
        XCTAssertEqual(
            Dictation.updateTranscript("I walked to the store", new: "I walked to a store"),
            "I walked to a store"
        )
    }

    func testABacktrackKeepsTheLongerTranscript() {
        XCTAssertEqual(
            Dictation.updateTranscript("first sentence", new: "first"),
            "first sentence"
        )
    }

    func testASharedFirstWordIsNotEnoughToMergeAcrossSegments() {
        XCTAssertEqual(
            Dictation.updateTranscript("first sentence", new: "first word"),
            "first sentence first word"
        )
    }


    func testPreferredLanguageComesFirst() {
        let locales = Dictation.localeCandidates(
            preferredLanguages: ["fr-FR", "de-DE"],
            current: Locale(identifier: "en-US")
        )
        XCTAssertEqual(Dictation.canonicalIdentifier(locales[0]), "fr_fr")
        XCTAssertTrue(locales.map(Dictation.canonicalIdentifier).contains("en_us"))
    }

    func testEnglishIsNotDuplicatedWhenItIsAlreadyPreferred() {
        let locales = Dictation.localeCandidates(
            preferredLanguages: ["en-US"],
            current: Locale(identifier: "en-US")
        )
        let keys = locales.map(Dictation.canonicalIdentifier)
        XCTAssertEqual(keys, ["en_us"])
    }

    func testHyphenAndUnderscoreAreTheSameCandidate() {
        let locales = Dictation.localeCandidates(
            preferredLanguages: ["en-US"],
            current: Locale(identifier: "en_US")
        )
        XCTAssertEqual(locales.map(Dictation.canonicalIdentifier), ["en_us"])
    }

    func testEnglishIsTheLastResortWhenNothingElseIsOffered() {
        let locales = Dictation.localeCandidates(
            preferredLanguages: [],
            current: Locale(identifier: "ja-JP")
        )
        XCTAssertEqual(Dictation.canonicalIdentifier(locales[0]), "ja_jp")
        XCTAssertEqual(locales.last.map(Dictation.canonicalIdentifier), "en_us")
    }

    func testPreferredLanguageProbingIsBounded() {
        let locales = Dictation.localeCandidates(
            preferredLanguages: ["fr-FR", "de-DE", "it-IT", "es-ES", "pt-BR"],
            current: Locale(identifier: "ja-JP")
        )
        let keys = locales.map(Dictation.canonicalIdentifier)
        XCTAssertEqual(Array(keys.prefix(3)), ["fr_fr", "de_de", "it_it"])
        XCTAssertFalse(keys.contains("es_es"))
        XCTAssertFalse(keys.contains("pt_br"))
        XCTAssertEqual(Array(keys.suffix(2)), ["ja_jp", "en_us"])
    }
}
