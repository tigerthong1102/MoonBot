import Foundation
import XCTest
@testable import CompanionCore

private final class AiTwinRequestStub: URLProtocol {
    static var requests: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.requests.append(request)
        let response = HTTPURLResponse(
            url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"]
        )!
        let body = request.httpMethod == "GET"
            ? #"{"twin":{"id":"twin","name":"Owner","revision":2,"paused":false},"preview":{"key":"provider","name":"Fixture","model":"test"}}"#
            : #"{"draft":"A private response"}"#
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class AiTwinClientTests: XCTestCase {
    func testUsesPairedHTTPSWhenOrdinaryChatUsesLAN() async throws {
        let hosted = try XCTUnwrap(CompanionEndpoint(url: "https://paired.example", kind: .hosted, priority: 50))
        let lan = try XCTUnwrap(CompanionEndpoint.direct(host: "192.168.1.4", port: 8810, priority: 0))
        let connection = Connection(name: "Desktop", host: lan.host, port: lan.port, activeEndpoint: lan, endpoints: [lan, hosted])
        AiTwinRequestStub.requests = []
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AiTwinRequestStub.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let client = CompanionClient(connection: connection, token: "paired-token", session: session)

        let status = try await client.aiTwin()
        let profile = try XCTUnwrap(status.twin)
        let provider = try XCTUnwrap(status.preview)
        _ = try await client.askAiTwin(profile, question: "Private", action: .semantic, provider: provider)
        let draft = try await client.askAiTwin(profile, question: "Private", action: .draft, provider: provider)

        XCTAssertEqual(draft.draft, "A private response")
        XCTAssertEqual(AiTwinRequestStub.requests.map { $0.url?.host }, Array(repeating: "paired.example", count: 3))
        XCTAssertEqual(AiTwinRequestStub.requests.map { $0.value(forHTTPHeaderField: "Authorization") }, Array(repeating: "Bearer paired-token", count: 3))
        XCTAssertEqual(AiTwinRequestStub.requests.map { $0.url?.path }, ["/api/ai-twin", "/api/ai-twin/lookup", "/api/ai-twin/preview"])
        XCTAssertEqual(AiTwinRequestStub.requests.map(\.timeoutInterval), [20, 45, 65])
    }
}
