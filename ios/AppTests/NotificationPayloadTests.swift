import Foundation
import UserNotifications
import XCTest
import CompanionCore
@testable import StartupBot

final class NotificationPayloadTests: XCTestCase {
    func testNotificationKeepsItsOriginAndDoesNotReplaceAnotherComputersAlert() throws {
        let frame = try JSONDecoder().decode(NotificationFrame.self, from: Data("""
        {"kind":"question","botId":"bot","botName":"Fixture","threadId":"thread","title":"Question","body":"Choose a plan"}
        """.utf8))
        let first = NotificationCoordinator.request(frame, sequence: 12, connectionID: "computer-a")
        let replay = NotificationCoordinator.request(frame, sequence: 12, connectionID: "computer-a")
        let other = NotificationCoordinator.request(frame, sequence: 12, connectionID: "computer-b")
        let payload = first.content.userInfo.reduce(into: [String: String]()) { result, entry in
            if let key = entry.key as? String, let value = entry.value as? String { result[key] = value }
        }
        XCTAssertEqual(NotificationTarget(payload: payload), NotificationTarget(botId: "bot", threadId: "thread", connectionID: "computer-a"))
        XCTAssertEqual(Set(payload.keys), Set(["botId", "threadId", "kind", "connectionId"]))
        XCTAssertEqual(first.identifier, replay.identifier)
        XCTAssertNotEqual(first.identifier, other.identifier)
        XCTAssertNotEqual(first.content.threadIdentifier, other.content.threadIdentifier)
    }
}
