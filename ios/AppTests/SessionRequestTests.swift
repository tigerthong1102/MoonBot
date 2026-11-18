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
        let pending = active
        active = nil
        lock.unlock()
        let pending = try XCTUnwrap(pending)
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
    private func exerciseSend(status: Int, body: String, replace: Bool, sameID: Bool = false, legacy: Bool = false) async throws -> (Session, Bool) {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [DeferredResponseProtocol.self]
        let transport = URLSession(configuration: config)
        defer { transport.invalidateAndCancel(); DeferredResponseProtocol.started = nil }
        let old = Connection(id: "old", name: "Old fixture", host: "127.0.0.1", port: 19991)
        let client = CompanionClient(connection: old, token: "fixture-only", session: transport)
        let session = Session(fixtureClient: client)
        let chat = Chat.bot(try bot())
        let started = expectation(description: "The old computer receives the request")
        DeferredResponseProtocol.started = { started.fulfill() }
        let pending = Task { @MainActor in
            if legacy { await session.send("fixture", to: chat); return false }
            return await session.send(text: "fixture", attachments: [], to: chat)
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
}
