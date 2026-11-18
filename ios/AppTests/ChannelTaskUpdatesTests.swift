import Foundation
import XCTest
import CompanionCore
@testable import StartupBot

final class ChannelTaskUpdatesTests: XCTestCase {
    @MainActor
    func testBackgroundChannelApprovalsKeepExactNavigationAndViewIdentity() throws {
        let fleet = try JSONDecoder().decode(Fleet.self, from: Data(#"""
        {"bots":[],"groups":[{"id":"channel","threadId":"selected","name":"Fixture","memberIds":[],
          "defaultResponder":{"kind":"all"},"bulletin":"","unread":false,"createdAt":1,
          "tasks":[{"threadId":"selected","title":"Current","createdAt":1},
                   {"threadId":"first","title":"First","createdAt":2},
                   {"threadId":"second","title":"Second","createdAt":3}]}]}
        """#.utf8))
        var state = CompanionState()
        state.hydrate(fleet)
        for (index, thread) in ["first", "second"].enumerated() {
            let message = try JSONDecoder().decode(Message.self, from: Data("""
            {"id":"approval-\(index)","role":"bot","kind":"options","at":\(index+1),
             "card":{"title":"Allow?","subtitle":"Fixture action","options":["Allow","Deny"],"requestId":"request-\(index)","tool":"Bash"}}
            """.utf8))
            state.apply(.messagePatch(threadId: thread, message: message))
        }
        let updates = state.updates.filter { $0.kind == .needsYou }
        XCTAssertEqual(Set(updates.map { $0.chat.threadId }), ["first", "second"])
        XCTAssertEqual(Set(updates.map(\.chat)).count, 2)
        let first = try XCTUnwrap(updates.first { $0.chat.threadId == "first" }?.chat)
        let second = try XCTUnwrap(updates.first { $0.chat.threadId == "second" }?.chat)
        XCTAssertNotEqual(first, second)
        XCTAssertNotEqual(first.conversationID, second.conversationID)
        XCTAssertEqual(first.projected(in: state, forThread: "first")?.threadId, "first")
        XCTAssertNil(first.projected(in: state, forThread: "foreign"))
        XCTAssertEqual(state.rooms.first?.threadId, "selected")
    }

    @MainActor
    func testUnreadChannelUpdatesOpenEachUnreadTaskAndDisappearWhenRead() throws {
        let fleet = try JSONDecoder().decode(Fleet.self, from: Data(#"""
        {"bots":[],"groups":[{"id":"channel","threadId":"selected","name":"Fixture","memberIds":[],
          "defaultResponder":{"kind":"all"},"bulletin":"","unread":true,"createdAt":1,
          "tasks":[{"threadId":"selected","title":"Current","createdAt":1,"unread":false},
                   {"threadId":"first","title":"First","createdAt":2,"unread":true},
                   {"threadId":"second","title":"Second","createdAt":3,"unread":true}]}]}
        """#.utf8))
        var state = CompanionState()
        state.hydrate(fleet)
        for thread in ["selected", "first", "second"] {
            let message = try JSONDecoder().decode(Message.self, from: Data("""
            {"id":"message-\(thread)","role":"bot","kind":"text","at":1,"text":"reply-\(thread)"}
            """.utf8))
            state.apply(.messagePatch(threadId: thread, message: message))
        }
        XCTAssertEqual(state.updates.map { $0.chat.threadId }, ["first", "second"])
        XCTAssertEqual(state.updates.map(\.line), ["reply-first", "reply-second"])
        XCTAssertTrue(state.updates.allSatisfy { $0.kind == .toReview && $0.chat.unread })
        var room = try XCTUnwrap(fleet.groups.first)
        room.tasks?[1].unread = false
        state.hydrate(Fleet(bots: [], groups: [room]))
        XCTAssertEqual(state.updates.map { $0.chat.threadId }, ["second"])
        room.tasks?[2].unread = false
        room.unread = false
        state.hydrate(Fleet(bots: [], groups: [room]))
        XCTAssertTrue(state.updates.isEmpty)
    }

}
