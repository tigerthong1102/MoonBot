// Modified for StartupBot; original copyright and license retained.
import XCTest
@testable import CompanionCore

final class BotActivityContentTests: XCTestCase {
    private func card(_ requestId: String = "request") -> OptionCard {
        OptionCard(title: "Run shell?", subtitle: "echo hello", options: ["Allow", "Deny"], requestId: requestId, tool: "shell")
    }

    private func content(threadId: String = "thread-a", card: OptionCard? = nil, kind: String = "needsYou") -> BotActivityContent {
        BotActivityContent(
            face: "waiting", kind: kind, headline: "Pepper needs you", line: "echo hello",
            threadId: threadId, connectionID: "fixture", card: card ?? self.card(), since: Date(timeIntervalSince1970: 0)
        )
    }

    func testReusedActivityTargetsCurrentSiblingThreadEvenWhenRequestIdIsTheSame() throws {
        let original = content(threadId: "thread-a")
        let sibling = content(threadId: "thread-b")
        let rendered = try JSONDecoder().decode(BotActivityContent.self, from: JSONEncoder().encode(sibling))
        XCTAssertNotEqual(original, sibling, "A thread change must send an activity update")
        XCTAssertEqual(rendered.approvalThreadId, "thread-b")
        XCTAssertTrue(rendered.canAnswer(connectionID: "fixture", threadId: "thread-b", requestId: "request", choice: "Allow", isPermission: true))
        XCTAssertFalse(rendered.canAnswer(connectionID: "fixture", threadId: "thread-a", requestId: "request", choice: "Allow", isPermission: true))
    }

    func testLegacyActivityDecodesButCannotAnswerUsingOriginalAttributes() throws {
        let legacy = """
        {"face":"waiting","kind":"needsYou","headline":"Pepper needs you","line":"echo hello",
        "requestId":"request","options":["Allow","Deny"],"isPermission":true,"since":0}
        """
        let rendered = try JSONDecoder().decode(BotActivityContent.self, from: Data(legacy.utf8))
        XCTAssertEqual(rendered.headline, "Pepper needs you")
        XCTAssertNil(rendered.threadId)
        XCTAssertNil(rendered.approvalThreadId)
        XCTAssertFalse(rendered.canAnswer(connectionID: "fixture", threadId: "original-thread", requestId: "request", choice: "Allow", isPermission: true))
    }

    func testStaleOrChangedIntentCannotAnswer() {
        let current = content(card: card("new-request"))
        XCTAssertFalse(current.canAnswer(connectionID: "fixture", threadId: "thread-a", requestId: "old-request", choice: "Allow", isPermission: true))
        XCTAssertFalse(current.canAnswer(connectionID: "fixture", threadId: "thread-a", requestId: "new-request", choice: "Always allow", isPermission: true))
        XCTAssertFalse(current.canAnswer(connectionID: "fixture", threadId: "thread-a", requestId: "new-request", choice: "Allow", isPermission: false))
        XCTAssertTrue(current.canAnswer(connectionID: "fixture", threadId: "thread-a", requestId: "new-request", choice: "Deny", isPermission: true))
    }

    func testQuestionKeepsItsExactChoicesAndResponseKind() {
        let question = OptionCard(title: "Which?", subtitle: "", options: ["First", "Second"], requestId: "question")
        let current = content(card: question)
        XCTAssertTrue(current.canAnswer(connectionID: "fixture", threadId: "thread-a", requestId: "question", choice: "Second", isPermission: false))
        XCTAssertFalse(current.canAnswer(connectionID: "fixture", threadId: "thread-a", requestId: "question", choice: "Allow", isPermission: true))
    }

    func testAnsweredDismissedAndWorkingStatesOfferNoAction() {
        var answered = card()
        answered.answered = "Allow"
        var dismissed = card()
        dismissed.dismissed = true
        for current in [content(card: answered), content(card: dismissed), content(kind: "working")] {
            XCTAssertNil(current.approvalThreadId)
            XCTAssertFalse(current.canAnswer(connectionID: "fixture", threadId: "thread-a", requestId: "request", choice: "Allow", isPermission: true))
        }
    }

    func testSkillApprovalStillRequiresOpeningTheChat() throws {
        let payload = """
        {"title":"Enable skill?","subtitle":"Review this skill","options":["Enable","Deny"],
        "requestId":"skill","tool":"stage_skill","skillRequest":{
        "version":1,"requestId":"skill","botId":"pepper","threadId":"thread-b","stagedId":"staged",
        "action":"create","name":"verify","gist":"Verify the app","warnings":[],"createdAt":0}}
        """
        let skill = try JSONDecoder().decode(OptionCard.self, from: Data(payload.utf8))
        let current = content(threadId: "thread-b", card: skill)
        XCTAssertEqual(current.threadId, "thread-b")
        XCTAssertEqual(current.requestId, "skill", "Keep the alert visible")
        XCTAssertTrue(current.options.isEmpty)
        XCTAssertNil(current.approvalThreadId)
    }

    func testActivityAnswersRequireTheOriginatingComputerEvenWithMatchingRequestIds() throws {
        let original = content()
        XCTAssertTrue(original.canAnswer(connectionID: "fixture", threadId: "thread-a", requestId: "request", choice: "Allow", isPermission: true))
        for origin in [nil, "", "other"] as [String?] {
            XCTAssertFalse(original.canAnswer(connectionID: origin, threadId: "thread-a", requestId: "request", choice: "Allow", isPermission: true))
        }
        var unscoped = original
        unscoped.connectionID = nil
        XCTAssertNil(unscoped.approvalThreadId)
        let decoded = try JSONDecoder().decode(BotActivityContent.self, from: JSONEncoder().encode(original))
        XCTAssertEqual(decoded.connectionID, "fixture")
    }

    func testEmptyTargetOrRequestCannotOfferButtons() {
        XCTAssertNil(content(threadId: "").approvalThreadId)
        XCTAssertNil(content(card: card("")).approvalThreadId)
    }
}
