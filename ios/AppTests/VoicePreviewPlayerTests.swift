import AVFAudio
import Foundation
import XCTest
@testable import StartupBot

final class VoicePreviewPlayerTests: XCTestCase {
    private var silence: Data {
        var bytes = Data("RIFF".utf8)
        func word(_ value: UInt32) { var value = value.littleEndian; bytes.append(Data(bytes: &value, count: 4)) }
        func short(_ value: UInt16) { var value = value.littleEndian; bytes.append(Data(bytes: &value, count: 2)) }
        word(196); bytes.append(Data("WAVEfmt ".utf8)); word(16); short(1); short(1)
        word(8000); word(16000); short(2); short(16); bytes.append(Data("data".utf8)); word(160)
        bytes.append(Data(repeating: 0, count: 160))
        return bytes
    }

    @MainActor
    func testCompletionReleasesTheAudioSessionExactlyOnce() async throws {
        let finished = expectation(description: "Preview releases audio")
        var releases = 0
        let preview = VoicePreviewPlayer(activate: {}, deactivate: { releases += 1; finished.fulfill() }, start: { _ in true })
        let request = preview.begin()
        try preview.play(silence, request: request)
        let player = try XCTUnwrap(preview.player)
        preview.audioPlayerDidFinishPlaying(player, successfully: true)
        await fulfillment(of: [finished], timeout: 2)
        XCTAssertNil(preview.player)
        preview.stop()
        XCTAssertEqual(releases, 1)
    }

    @MainActor
    func testDismissalStopsPlaybackAndRejectsLateGeneratedAudio() throws {
        var activations = 0
        var releases = 0
        let preview = VoicePreviewPlayer(activate: { activations += 1 }, deactivate: { releases += 1 }, start: { _ in true })
        let request = preview.begin()
        try preview.play(silence, request: request)
        let player = try XCTUnwrap(preview.player)
        preview.stop()
        XCTAssertNil(player.delegate)
        XCTAssertNil(preview.player)
        try preview.play(silence, request: request)
        XCTAssertEqual(activations, 1)
        XCTAssertEqual(releases, 1)
    }

    @MainActor
    func testFailedPlaybackReleasesItsActivatedSession() {
        var releases = 0
        let preview = VoicePreviewPlayer(activate: {}, deactivate: { releases += 1 }, start: { _ in false })
        let request = preview.begin()
        XCTAssertThrowsError(try preview.play(silence, request: request))
        XCTAssertNil(preview.player)
        XCTAssertEqual(releases, 1)
    }

    @MainActor
    func testDecodeFailureReleasesItsActivatedSession() {
        var releases = 0
        let preview = VoicePreviewPlayer(activate: {}, deactivate: { releases += 1 }, start: { _ in true })
        let request = preview.begin()
        XCTAssertThrowsError(try preview.play(Data(), request: request))
        XCTAssertEqual(releases, 1)
    }

    @MainActor
    func testAnOldCompletionCannotStopTheReplacementPreview() async throws {
        var releases = 0
        var observingOldCompletion = true
        let unexpected = expectation(description: "Old completion cannot release new preview")
        unexpected.isInverted = true
        let preview = VoicePreviewPlayer(activate: {}, deactivate: { releases += 1; if releases > 1 && observingOldCompletion { unexpected.fulfill() } }, start: { _ in true })
        try preview.play(silence, request: preview.begin())
        let old = try XCTUnwrap(preview.player)
        try preview.play(silence, request: preview.begin())
        let current = try XCTUnwrap(preview.player)
        preview.audioPlayerDidFinishPlaying(old, successfully: true)
        await fulfillment(of: [unexpected], timeout: 0.1)
        XCTAssertTrue(preview.player === current)
        XCTAssertEqual(releases, 1)
        observingOldCompletion = false
        preview.stop()
    }
}
