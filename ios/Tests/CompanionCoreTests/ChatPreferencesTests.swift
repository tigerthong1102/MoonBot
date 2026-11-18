// Modified for StartupBot; original copyright and license retained.
import XCTest
@testable import CompanionCore

final class ChatPreferencesTests: XCTestCase {
    private func text(_ id: String, at: Double = 1) -> Message {
        var message = Message(id: id, role: .bot, kind: .text, at: at)
        message.text = "hello"
        return message
    }

    private func activity(_ id: String, at: Double = 1, ok: Bool? = true) -> Message {
        var message = Message(id: id, role: .bot, kind: .activity, at: at)
        message.tool = ToolActivity(name: "run", ok: ok)
        return message
    }


    func testFullKeepsEveryMessageInOrder() {
        let messages = [text("a"), activity("b"), activity("c"), text("d")]
        let rows = transcriptRows(messages, detail: .full)
        XCTAssertEqual(rows.map(\.id), ["a", "b", "c", "d"])
        XCTAssertTrue(rows.allSatisfy { if case .message = $0 { return true } else { return false } })
    }


    func testHiddenDropsActivityAndKeepsTheRest() {
        let messages = [text("a"), activity("b"), activity("c"), text("d")]
        XCTAssertEqual(transcriptRows(messages, detail: .hidden).map(\.id), ["a", "d"])
    }

    func testHiddenDropsFailedActivityToo() {
        let messages = [text("a"), activity("b", ok: false)]
        XCTAssertEqual(transcriptRows(messages, detail: .hidden).map(\.id), ["a"])
    }


    func testReducedCollapsesConsecutiveActivityIntoOneRun() {
        let messages = [text("a"), activity("b"), activity("c"), activity("d"), text("e")]
        let rows = transcriptRows(messages, detail: .reduced)
        XCTAssertEqual(rows.count, 3)
        guard case let .activityRun(items) = rows[1] else { return XCTFail("expected a run") }
        XCTAssertEqual(items.map(\.id), ["b", "c", "d"])
    }

    func testReducedLeavesALoneActivityAlone() {
        let messages = [text("a"), activity("b"), text("c")]
        let rows = transcriptRows(messages, detail: .reduced)
        XCTAssertEqual(rows.map(\.id), ["a", "b", "c"])
        guard case .message = rows[1] else { return XCTFail("expected a plain message") }
    }

    func testReducedBreaksOutAFailureOnItsOwn() {
        let messages = [activity("a"), activity("b"), activity("c", ok: false), activity("d"), activity("e")]
        let rows = transcriptRows(messages, detail: .reduced)
        XCTAssertEqual(rows.count, 3)
        guard case let .activityRun(before) = rows[0] else { return XCTFail("expected a run") }
        XCTAssertEqual(before.map(\.id), ["a", "b"])
        guard case let .message(failed) = rows[1] else { return XCTFail("expected the failure alone") }
        XCTAssertEqual(failed.id, "c")
        guard case let .activityRun(after) = rows[2] else { return XCTFail("expected a run") }
        XCTAssertEqual(after.map(\.id), ["d", "e"])
    }

    func testReducedSplitsRunsAroundOtherMessages() {
        let messages = [activity("a"), activity("b"), text("c"), activity("d"), activity("e")]
        let rows = transcriptRows(messages, detail: .reduced)
        XCTAssertEqual(rows.count, 3)
        guard case .activityRun = rows[0] else { return XCTFail("expected a run") }
        guard case .message = rows[1] else { return XCTFail("expected the text") }
        guard case .activityRun = rows[2] else { return XCTFail("expected a run") }
    }

    func testReducedRunReportsStillRunningWhileAStepHasNoVerdict() {
        let messages = [activity("a"), activity("b", ok: nil)]
        let rows = transcriptRows(messages, detail: .reduced)
        guard case let .activityRun(items) = rows[0] else { return XCTFail("expected a run") }
        XCTAssertTrue(items.contains { $0.tool?.ok == nil })
    }

    func testRowCarriesTheTimeAndSenderOfItsFirstMessage() {
        let rows = transcriptRows([activity("a", at: 500), activity("b", at: 900)], detail: .reduced)
        XCTAssertEqual(rows[0].at, 500)
        XCTAssertEqual(rows[0].kind, .activity)
        XCTAssertEqual(rows[0].role, .bot)
        XCTAssertEqual(rows[0].endAt, 900)
    }

    func testEmptyTranscriptStaysEmptyAtEveryLevel() {
        for detail in ActivityDetail.allCases {
            XCTAssertTrue(transcriptRows([], detail: detail).isEmpty)
        }
    }


    func testDefaultsAreTheFourChipsTheComposerAlreadyShows() {
        XCTAssertEqual(QuickReply.defaults.count, 4)
        XCTAssertEqual(QuickReply.defaults.map(\.title), ["Show diff", "Run tests", "Explain steps", "What's next?"])
    }

    func testQuickRepliesSurviveARoundTrip() {
        let mine = [
            QuickReply(title: "Deploy", prompt: "Deploy to staging", icon: "paperplane"),
            QuickReply(title: "Log", prompt: "Show the last 50 log lines", icon: "doc.text"),
        ]
        XCTAssertEqual(QuickReply.decode(QuickReply.encode(mine)), mine)
    }

    func testAnEmptyStoreFallsBackToDefaults() {
        XCTAssertEqual(QuickReply.decode(""), QuickReply.defaults)
    }

    func testCorruptStoreFallsBackToDefaultsRatherThanNoChips() {
        XCTAssertEqual(QuickReply.decode("{not json"), QuickReply.defaults)
    }

    func testDeletingEveryChipIsRespectedRatherThanReset() {
        XCTAssertEqual(QuickReply.decode(QuickReply.encode([])), [])
    }

    func testEmptyQuickReplyIDFallsBackToDefaults() {
        let replies = [QuickReply(id: " ", title: "Deploy", prompt: "Deploy", icon: "paperplane")]
        XCTAssertEqual(QuickReply.decode(QuickReply.encode(replies)), QuickReply.defaults)
    }

    func testDuplicateQuickReplyIDsFallBackToDefaults() {
        let replies = [
            QuickReply(id: "same", title: "Deploy", prompt: "Deploy", icon: "paperplane"),
            QuickReply(id: "same", title: "Logs", prompt: "Show logs", icon: "doc.text"),
        ]
        XCTAssertEqual(QuickReply.decode(QuickReply.encode(replies)), QuickReply.defaults)
    }


    func testIslandIntroDefaultsToOncePerBot() {
        XCTAssertEqual(IslandIntro.oncePerBot.rawValue, "oncePerBot")
        XCTAssertEqual(IslandIntro(rawValue: "nonsense"), nil)
        XCTAssertEqual(IslandIntro.allCases.count, 3)
    }
}
