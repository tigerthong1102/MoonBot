import Foundation
import XCTest
import CompanionCore
@testable import StartupBot

final class LiveActivityUpdatesTests: XCTestCase {
    @MainActor
    func testApprovalWinsOverWorkingSiblingWithoutHidingOtherBots() throws {
        let fleet = try JSONDecoder().decode(Fleet.self, from: Data("""
        {"bots":[
          {"id":"one","threadId":"working","name":"One","title":"","description":"","notifications":true,"color":"blue","unread":false,"createdAt":1,"modelSelection":{"instanceId":"fake","model":"fake"},"tasks":[
            {"threadId":"working","title":"Work","createdAt":2,"busy":true},
            {"threadId":"approval","title":"Approve","createdAt":1,"activity":"waiting-on-you"}]},
          {"id":"two","threadId":"other","name":"Two","title":"","description":"","notifications":true,"color":"green","unread":false,"createdAt":1,"modelSelection":{"instanceId":"fake","model":"fake"},"tasks":[{"threadId":"other","title":"Other work","createdAt":1,"busy":true}]}
        ],"groups":[]}
        """.utf8))
        var state = CompanionState()
        state.hydrate(fleet)
        XCTAssertEqual(state.updates.count, 3)
        XCTAssertEqual(state.liveActivityUpdates.count, 2)
        XCTAssertEqual(state.liveActivityUpdates.first?.kind, .needsYou)
        XCTAssertEqual(state.liveActivityUpdates.first?.chat.threadId, "approval")
        XCTAssertEqual(Set(state.liveActivityUpdates.map { $0.chat.id }), ["one", "two"])
    }
}
