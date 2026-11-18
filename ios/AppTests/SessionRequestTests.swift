import Foundation
import XCTest
import CompanionCore
@testable import StartupBot

final class DeferredResponseProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var active: DeferredResponseProtocol?
    static var started: (() -> Void)?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        Self.active = self
        let notify = Self.started
        Self.lock.unlock()
        notify?()
    }

    override func stopLoading() {}

    static func finish(status: Int, body: String) throws {
        lock.lock()
        let captured = active
        active = nil
        lock.unlock()
        let pending = try XCTUnwrap(captured)
        let response = try XCTUnwrap(HTTPURLResponse(url: pending.request.url!, statusCode: status, httpVersion: nil, headerFields: ["content-type": "application/json"]))
        pending.client?.urlProtocol(pending, didReceive: response, cacheStoragePolicy: .notAllowed)
        pending.client?.urlProtocol(pending, didLoad: Data(body.utf8))
        pending.client?.urlProtocolDidFinishLoading(pending)
    }
}

final class SessionRequestTests: XCTestCase {
    private func bot() throws -> Bot {
        try JSONDecoder().decode(Bot.self, from: Data("""
        {"id":"bot","threadId":"thread","name":"Fixture","title":"","description":"",
         "notifications":true,"color":"blue","unread":false,"createdAt":1,
         "modelSelection":{"instanceId":"fake","model":"fake"}}
        """.utf8))
    }

    @MainActor
    private func exercise<Result: Sendable>(status: Int, body: String, replace: Bool, sameID: Bool = false, fleet: Fleet? = nil, operation: @escaping @MainActor (Session, Bot) async -> Result) async throws -> (Session, Result) {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [DeferredResponseProtocol.self]
        let transport = URLSession(configuration: config)
        defer { transport.invalidateAndCancel(); DeferredResponseProtocol.started = nil }
        let old = Connection(id: "old", name: "Old fixture", host: "127.0.0.1", port: 19991)
        let client = CompanionClient(connection: old, token: "fixture-only", session: transport)
        let session = Session(fixtureClient: client, fleet: fleet)
        let target = try bot()
        let started = expectation(description: "The old computer receives the request")
        DeferredResponseProtocol.started = { started.fulfill() }
        let pending = Task { @MainActor in
            await operation(session, target)
        }
        await fulfillment(of: [started], timeout: 5)
        if replace {
            let next = Connection(id: sameID ? "old" : "new", name: "New fixture", host: "127.0.0.1", port: 19992)
            session.replaceFixtureClient(CompanionClient(connection: next, token: "new-fixture-only", session: transport))
            session.actionError = "current connection notice"
        }
        try DeferredResponseProtocol.finish(status: status, body: body)
        return (session, await pending.value)
    }

    @MainActor
    private func exerciseSend(status: Int, body: String, replace: Bool, sameID: Bool = false, legacy: Bool = false) async throws -> (Session, Bool) {
        try await exercise(status: status, body: body, replace: replace, sameID: sameID) { session, bot in
            if legacy { await session.send("fixture", to: .bot(bot)); return false }
            return await session.send(text: "fixture", attachments: [], to: .bot(bot))
        }
    }

    @MainActor
    func testLateUnauthorizedSendCannotInvalidateAnotherComputer() async throws {
        let (session, accepted) = try await exerciseSend(status: 401, body: "{}", replace: true)
        XCTAssertFalse(accepted)
        XCTAssertEqual(session.status, .live)
        XCTAssertEqual(session.connection?.id, "new")
        XCTAssertEqual(session.actionError, "current connection notice")
    }

    @MainActor
    func testLateSendCannotInvalidateANewRuntimeForTheSameComputer() async throws {
        let (session, accepted) = try await exerciseSend(status: 401, body: "{}", replace: true, sameID: true)
        XCTAssertFalse(accepted)
        XCTAssertEqual(session.status, .live)
    }

    @MainActor
    func testCurrentUnauthorizedSendStillRequiresReauthentication() async throws {
        let (session, accepted) = try await exerciseSend(status: 401, body: "{}", replace: false)
        XCTAssertFalse(accepted)
        XCTAssertEqual(session.status, .unauthorized)
    }

    @MainActor
    func testLateQueuedReceiptCannotEnterTheNewComputersConversation() async throws {
        let receipt = "{\"queued\":true,\"queueId\":\"old-queue\",\"threadId\":\"thread\"}"
        for legacy in [false, true] {
            let (session, accepted) = try await exerciseSend(status: 202, body: receipt, replace: true, legacy: legacy)
            XCTAssertFalse(accepted)
            XCTAssertTrue(session.state.pendingQueued.isEmpty)
            XCTAssertEqual(session.actionError, "current connection notice")
        }
    }

    @MainActor
    func testCurrentQueuedReceiptRemainsVisible() async throws {
        let (session, accepted) = try await exerciseSend(status: 202, body: "{\"queued\":true,\"queueId\":\"queue\",\"threadId\":\"thread\"}", replace: false)
        XCTAssertTrue(accepted)
        XCTAssertEqual(session.state.pendingQueued["thread"]?.first?.queueId, "queue")
    }

    @MainActor
    func testLateHistoryCannotPopulateAnotherComputersThread() async throws {
        let body = "{\"messages\":[{\"id\":\"old-message\",\"role\":\"user\",\"kind\":\"text\",\"at\":1,\"text\":\"private old history\"}],\"hasMore\":false}"
        let (session, _) = try await exercise(status: 200, body: body, replace: true) { session, _ in
            await session.loadThreadIfNeeded("thread")
        }
        XCTAssertTrue(session.state.transcript(forThread: "thread").isEmpty)
        XCTAssertEqual(session.actionError, "current connection notice")
    }

    @MainActor
    func testCurrentHistoryStillLoads() async throws {
        let body = "{\"messages\":[{\"id\":\"current-message\",\"role\":\"user\",\"kind\":\"text\",\"at\":1,\"text\":\"current history\"}],\"hasMore\":false}"
        let (session, _) = try await exercise(status: 200, body: body, replace: false) { session, _ in
            await session.loadThreadIfNeeded("thread")
        }
        XCTAssertEqual(session.state.transcript(forThread: "thread").first?.text, "current history")
        XCTAssertNil(session.actionError)
    }

    @MainActor
    func testLateConnectorAuthorizationCannotOpenForAnotherComputer() async throws {
        let (session, url) = try await exercise(status: 200, body: "{\"url\":\"https://fixture.invalid/authorize\"}", replace: true) { session, _ in
            await session.authorizeConnector("fixture", alias: nil)
        }
        XCTAssertNil(url)
        XCTAssertEqual(session.actionError, "current connection notice")
    }

    @MainActor
    func testCurrentConnectorAuthorizationStillReturnsItsURL() async throws {
        let (session, url) = try await exercise(status: 200, body: "{\"url\":\"https://fixture.invalid/authorize\"}", replace: false) { session, _ in
            await session.authorizeConnector("fixture", alias: nil)
        }
        XCTAssertEqual(url?.absoluteString, "https://fixture.invalid/authorize")
        XCTAssertNil(session.actionError)
    }

    @MainActor
    func testCreatedBotIsFoldedOnlyIntoItsOriginatingComputer() async throws {
        let botJSON = String(decoding: try JSONEncoder().encode(bot()), as: UTF8.self)
        for replace in [false, true] {
            let (session, created) = try await exercise(status: 201, body: "{\"bot\":\(botJSON)}", replace: replace) { session, _ in
                await session.createBot()
            }
            if replace {
                XCTAssertNil(created)
                XCTAssertNil(session.state.bot("bot"))
                XCTAssertEqual(session.actionError, "current connection notice")
            } else {
                XCTAssertEqual(created?.id, "bot")
                XCTAssertEqual(session.state.bot("bot")?.id, "bot")
                XCTAssertNil(session.actionError)
            }
        }
    }

    @MainActor
    func testStructuredAnswersRequireAcknowledgmentFromTheCurrentComputer() async throws {
        let card = try JSONDecoder().decode(OptionCard.self, from: Data("""
        {"title":"Questions","subtitle":"","options":[],"requestId":"ask","tool":"AskUserQuestion","requestType":"question","questionRequest":{"version":1,"questions":[{"question":"Notes?","options":[]}]}}
        """.utf8))
        let request = try XCTUnwrap(card.questionRequest)
        var form = QuestionAnswerForm()
        form.setCustom("fixture answer", at: 0, in: request)
        for replace in [false, true] {
            let (session, accepted) = try await exercise(status: 200, body: "{}", replace: replace) { session, bot in
                await session.answerQuestions(chat: .bot(bot), card: card, form: form)
            }
            XCTAssertEqual(accepted, !replace)
            XCTAssertEqual(session.status, .live)
        }
    }

    @MainActor
    func testNotificationBotSwitchCannotPopulateAnotherComputersRoster() async throws {
        let original = try bot()
        var switched = original
        switched.threadId = "notification-thread"
        let payload = String(decoding: try JSONEncoder().encode(switched), as: UTF8.self)
        let target = try XCTUnwrap(NotificationTarget(botId: original.id, threadId: switched.threadId, connectionID: "old"))
        for replace in [false, true] {
            let (session, _) = try await exercise(status: 200, body: "{\"bot\":\(payload)}", replace: replace, fleet: Fleet(bots: [original], groups: [])) { session, _ in
                await session.openNotification(target)
            }
            if replace {
                XCTAssertNil(session.state.bot(original.id))
                XCTAssertNil(session.notificationChat)
                XCTAssertEqual(session.actionError, "current connection notice")
            } else {
                XCTAssertEqual(session.state.bot(original.id)?.threadId, switched.threadId)
                XCTAssertEqual(session.notificationChat?.threadId, switched.threadId)
                XCTAssertNil(session.actionError)
            }
        }
    }

    @MainActor
    func testNotificationRoomSwitchCannotPopulateAnotherComputersRoster() async throws {
        let original = try JSONDecoder().decode(Room.self, from: Data("""
        {"id":"room","threadId":"room-old","name":"Room fixture","memberIds":["bot"],"defaultResponder":{"kind":"mentions"},"bulletin":"","unread":false,"createdAt":1,"tasks":[{"threadId":"room-new","title":"Other","createdAt":1}]}
        """.utf8))
        var switched = original
        switched.threadId = "room-new"
        let payload = String(decoding: try JSONEncoder().encode(switched), as: UTF8.self)
        let target = try XCTUnwrap(NotificationTarget(botId: "bot", threadId: switched.threadId, connectionID: "old"))
        let fleet = Fleet(bots: [try bot()], groups: [original])
        for replace in [false, true] {
            let (session, _) = try await exercise(status: 200, body: "{\"group\":\(payload)}", replace: replace, fleet: fleet) { session, _ in
                await session.openNotification(target)
            }
            if replace {
                XCTAssertTrue(session.state.rooms.isEmpty)
                XCTAssertNil(session.notificationChat)
                XCTAssertEqual(session.actionError, "current connection notice")
            } else {
                XCTAssertEqual(session.state.rooms.first?.threadId, switched.threadId)
                XCTAssertEqual(session.notificationChat?.threadId, switched.threadId)
                XCTAssertNil(session.actionError)
            }
        }
    }

    @MainActor
    func testOldAndUnscopedNotificationsCannotContactTheSelectedComputer() async throws {
        for origin in ["old", nil] as [String?] {
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [DeferredResponseProtocol.self]
            let transport = URLSession(configuration: config)
            defer { transport.invalidateAndCancel(); DeferredResponseProtocol.started = nil }
            let connection = Connection(id: "new", name: "Selected fixture", host: "127.0.0.1", port: 19992)
            let client = CompanionClient(connection: connection, token: "fixture-only", session: transport)
            let session = Session(fixtureClient: client, fleet: Fleet(bots: [try bot()], groups: []))
            let contacted = expectation(description: "A foreign notification must not contact the selected computer")
            contacted.isInverted = true
            DeferredResponseProtocol.started = {
                contacted.fulfill()
                try? DeferredResponseProtocol.finish(status: 404, body: "{}")
            }
            let target = try XCTUnwrap(NotificationTarget(botId: "bot", threadId: "foreign-thread", connectionID: origin))
            await session.openNotification(target)
            await fulfillment(of: [contacted], timeout: 0.2)
            XCTAssertNil(session.notificationChat)
            XCTAssertEqual(session.state.bot("bot")?.threadId, "thread")
            XCTAssertEqual(session.connection?.id, "new")
            XCTAssertEqual(session.status, .live)
            XCTAssertNotNil(session.actionError)
        }
    }
}
