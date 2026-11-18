import Foundation
import XCTest
@testable import CompanionCore

final class SearchLandingTests: XCTestCase {
    private func page(_ range: ClosedRange<Int>, leaf: String = "m200") throws -> ThreadPage {
        let messages: [[String: Any]] = range.map { index in
            var message: [String: Any] = ["id":"m\(index)", "role":"bot", "kind":"text", "at":index, "text":"Message \(index)"]
            if index > 1 { message["parentId"] = "m\(index - 1)" }
            return message
        }
        return try JSONDecoder().decode(ThreadPage.self, from: JSONSerialization.data(withJSONObject: ["messages":messages, "activeLeafId":leaf, "hasMore":range.lowerBound > 1]))
    }

    func testConnectsOldSearchWindowToTheRenderedLeafWithoutSwitchingBranches() throws {
        var state = CompanionState()
        state.merge(try page(151...200), intoThread: "thread")
        var landing = SearchLanding(threadID: "thread", messageID: "m25")
        state = try landing.merge(page(1...50), into: state)
        XCTAssertFalse(state.visibleTranscript(forThread: "thread").contains { $0.id == "m25" })
        XCTAssertEqual(try landing.next(in: state), .around("m150"))
        state = try landing.merge(page(101...200), into: state)
        XCTAssertEqual(try landing.next(in: state), .around("m100"))
        state = try landing.merge(page(51...150), into: state)
        XCTAssertNil(try landing.next(in: state))
        XCTAssertEqual(state.visibleTranscript(forThread: "thread").map(\.id), (1...200).map { "m\($0)" })
        XCTAssertEqual(state.activeLeafIds["thread"], "m200")
    }

    func testLoadsTheCurrentTailWhenOnlyASparseWindowIsCached() throws {
        var landing = SearchLanding(threadID: "thread", messageID: "m25")
        let state = try landing.merge(page(1...50), into: CompanionState())
        XCTAssertEqual(try landing.next(in: state), .latest)
        XCTAssertNoThrow(try landing.merge(page(151...200), into: state))
    }

    func testRejectsARepeatedPageThatDoesNotContainTheRequestedParent() throws {
        var state = CompanionState()
        state.merge(try page(151...200), intoThread: "thread")
        var landing = SearchLanding(threadID: "thread", messageID: "m25")
        state = try landing.merge(page(1...50), into: state)
        _ = try landing.next(in: state)
        XCTAssertThrowsError(try landing.merge(page(1...50), into: state))
    }

    func testSearchCannotGrowHistoryPastItsMemoryOrRequestBudget() throws {
        let bounded = SearchLanding(threadID: "thread", messageID: "m25", maximumBytes: 100)
        XCTAssertThrowsError(try bounded.merge(page(1...50), into: CompanionState()))
        var state = CompanionState()
        state.merge(try page(151...200), intoThread: "thread")
        var onePage = SearchLanding(threadID: "thread", messageID: "m25", maximumPages: 1)
        state = try onePage.merge(page(1...50), into: state)
        XCTAssertThrowsError(try onePage.next(in: state))
    }

    func testOlderPageCannotRollBackALiveLeafUpdate() throws {
        var state = CompanionState()
        state.merge(try page(151...201, leaf: "m201"), intoThread: "thread")
        let landing = SearchLanding(threadID: "thread", messageID: "m175")
        state = try landing.merge(page(151...200, leaf: "m200"), into: state)
        XCTAssertEqual(state.activeLeafIds["thread"], "m201")
        XCTAssertEqual(state.visibleTranscript(forThread: "thread").last?.id, "m201")
    }
}
