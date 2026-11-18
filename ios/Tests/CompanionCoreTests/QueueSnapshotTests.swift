import Foundation
import XCTest
@testable import CompanionCore

final class QueueSnapshotTests: XCTestCase {
    private func frame(_ queues: String) throws -> Frame {
        try JSONDecoder().decode(Frame.self, from: Data("{\"kind\":\"bot.queued\",\"queues\":\(queues)}".utf8))
    }

    func testRemoteCancellationReplacesBotQueuesAndKeepsChannelQueues() throws {
        let room = try JSONDecoder().decode(Room.self, from: Data(#"""
        {"id":"room","threadId":"room-thread","name":"Fixture","memberIds":[],"defaultResponder":{"kind":"all"},"bulletin":"","unread":false,"createdAt":1}
        """#.utf8))
        var state = CompanionState()
        state.hydrate(Fleet(bots: [], groups: [room]))
        state.rememberQueued(QueuedSend(queueId: "old", text: "old"), inThread: "bot-thread")
        state.rememberQueued(QueuedSend(queueId: "channel", text: "room"), inThread: "room-thread")
        state.apply(try frame(#"{"bot-thread":[{"queueId":"new","text":"pending","reason":"busy"}]}"#))
        XCTAssertEqual(state.pendingQueued["bot-thread"]?.map(\.queueId), ["new"])
        XCTAssertEqual(state.pendingQueued["room-thread"]?.map(\.queueId), ["channel"])
        state.rememberQueued(QueuedSend(queueId: "old", text: "late receipt"), inThread: "bot-thread")
        XCTAssertEqual(state.pendingQueued["bot-thread"]?.map(\.queueId), ["new"])
        state.apply(try frame("{}"))
        XCTAssertNil(state.pendingQueued["bot-thread"])
        XCTAssertEqual(state.pendingQueued["room-thread"]?.map(\.queueId), ["channel"])
    }

    func testMalformedSnapshotDoesNotClearPendingMessages() throws {
        for malformed in ["null", "[]", "{\"thread\":42}", "{\"thread\":[{\"queueId\":3}]}" ] {
            var state = CompanionState()
            state.rememberQueued(QueuedSend(queueId: "keep", text: "keep"), inThread: "thread")
            state.apply(try frame(malformed))
            XCTAssertEqual(state.pendingQueued["thread"]?.map(\.queueId), ["keep"])
            XCTAssertEqual(state.botQueueRevision, 0)
        }
    }

    func testFleetSnapshotReconcilesCancellationAfterAConnectionGap() throws {
        var state = CompanionState()
        state.rememberQueued(QueuedSend(queueId: "cancelled", text: "cancelled"), inThread: "thread")
        let oldComputer = try JSONDecoder().decode(Fleet.self, from: Data(#"{"bots":[],"groups":[]}"#.utf8))
        state.hydrate(oldComputer)
        XCTAssertEqual(state.pendingQueued["thread"]?.count, 1)
        let fresh = try JSONDecoder().decode(Fleet.self, from: Data(#"{"bots":[],"groups":[],"botQueuedMessages":{}}"#.utf8))
        state.hydrate(fresh)
        XCTAssertNil(state.pendingQueued["thread"])
    }

    func testAnAuthoritativeSnapshotPreventsALateReceiptFromRecreatingAnUnknownCancelledEntry() throws {
        var state = CompanionState()
        let revision = state.botQueueRevision
        state.apply(try frame("{}"))
        state.rememberQueued(QueuedSend(queueId: "late", text: "cancelled elsewhere"), inThread: "thread", ifBotQueueRevisionMatches: revision)
        XCTAssertNil(state.pendingQueued["thread"])
        let current = state.botQueueRevision
        state.rememberQueued(QueuedSend(queueId: "new", text: "new"), inThread: "thread", ifBotQueueRevisionMatches: current)
        XCTAssertEqual(state.pendingQueued["thread"]?.map(\.queueId), ["new"])
    }

    func testQueueRemovalTombstonesStayBounded() throws {
        var state = CompanionState()
        for index in 0..<100 {
            state.rememberQueued(QueuedSend(queueId: "q\(index)", text: "pending"), inThread: "thread")
            state.apply(try frame("{}"))
        }
        XCTAssertLessThanOrEqual(state.drainedQueueIds.count, 64)
        XCTAssertTrue(state.pendingQueued.isEmpty)
    }
}
