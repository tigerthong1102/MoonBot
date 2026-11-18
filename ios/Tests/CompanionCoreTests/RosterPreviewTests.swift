// Modified for StartupBot; original copyright and license retained.
import XCTest
@testable import CompanionCore

final class RosterPreviewTests: XCTestCase {
    private func text(_ id: String, _ body: String, at: Double = 1) -> Message {
        var message = Message(id: id, role: .bot, kind: .text, at: at)
        message.text = body
        return message
    }

    private func activity(_ id: String, _ name: String, at: Double = 1, ok: Bool? = true) -> Message {
        var message = Message(id: id, role: .bot, kind: .activity, at: at)
        message.tool = ToolActivity(name: name, ok: ok)
        return message
    }

    private func card(_ id: String, title: String, subtitle: String, at: Double = 1, pending: Bool = true) -> Message {
        var message = Message(id: id, role: .bot, kind: .options, at: at)
        var card = OptionCard(title: title, subtitle: subtitle, options: ["Allow", "Deny"])
        if pending { card.requestId = "req-\(id)" }
        message.card = card
        return message
    }


    func testFullShowsTheToolNameWhenActivityLanded() {
        let messages = [text("a", "hello"), activity("b", "auto-approved shell: export PATH=…")]
        XCTAssertEqual(rosterPreview(messages, detail: .full), "auto-approved shell: export PATH=…")
    }


    func testHiddenFallsBackToTheLastRealMessage() {
        let messages = [text("a", "Deployed to staging"), activity("b", "auto-approved shell: export PATH=…")]
        XCTAssertEqual(rosterPreview(messages, detail: .hidden), "Deployed to staging")
    }

    func testHiddenSkipsAWholeTrailOfActivity() {
        let messages = [
            text("a", "Deployed to staging"),
            activity("b", "shell"), activity("c", "read"), activity("d", "write"),
        ]
        XCTAssertEqual(rosterPreview(messages, detail: .hidden), "Deployed to staging")
    }

    func testHiddenShowsNothingWhenTheThreadIsOnlyActivity() {
        let messages = [activity("a", "shell"), activity("b", "read")]
        XCTAssertEqual(rosterPreview(messages, detail: .hidden), "")
    }

    func testHiddenStillShowsAPendingCard() {
        let messages = [activity("a", "shell"), card("b", title: "Run this?", subtitle: "rm -rf build")]
        XCTAssertEqual(rosterPreview(messages, detail: .hidden), "rm -rf build")
    }

    func testAnAnsweredCardPreviewsAsItsTitle() {
        let messages = [card("a", title: "Run this?", subtitle: "rm -rf build", pending: false)]
        XCTAssertEqual(rosterPreview(messages, detail: .hidden), "Run this?")
    }


    func testReducedSummarisesATrailingRun() {
        let messages = [text("a", "hi"), activity("b", "shell"), activity("c", "read"), activity("d", "write")]
        XCTAssertEqual(rosterPreview(messages, detail: .reduced), "Ran 3 steps")
    }

    func testReducedSaysRunningWhileAStepIsUnfinished() {
        let messages = [activity("a", "shell"), activity("b", "read", ok: nil)]
        XCTAssertEqual(rosterPreview(messages, detail: .reduced), "Running 2 steps")
    }

    func testReducedLeavesALoneActivityAsItsToolName() {
        let messages = [text("a", "hi"), activity("b", "shell")]
        XCTAssertEqual(rosterPreview(messages, detail: .reduced), "shell")
    }

    func testReducedStillShowsAFailureRatherThanFoldingIt() {
        let messages = [activity("a", "shell"), activity("b", "deploy", ok: false)]
        XCTAssertEqual(rosterPreview(messages, detail: .reduced), "deploy")
    }


    func testTextAndScreenReadTheSameAtEveryLevel() {
        var screen = Message(id: "s", role: .bot, kind: .screen, at: 2)
        screen.text = nil
        for detail in ActivityDetail.allCases {
            XCTAssertEqual(rosterPreview([text("a", "plain words")], detail: detail), "plain words")
            XCTAssertEqual(rosterPreview([screen], detail: detail), "Screenshot")
        }
    }

    func testEmptyThreadPreviewsAsEmptyAtEveryLevel() {
        for detail in ActivityDetail.allCases {
            XCTAssertEqual(rosterPreview([], detail: detail), "")
        }
    }
}
