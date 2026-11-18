// Modified for StartupBot; original copyright and license retained.
// URLSession.AsyncBytes cancels its data task when released.
import XCTest
@testable import CompanionCore

/// A fake origin server that dribbles out an SSE response.
///
/// "Has this request been torn down?" is deliberately **per instance**, not
/// static. URLSession calls `stopLoading()` asynchronously, so a previous
/// test's teardown can land in the middle of the next one — which, when this
/// flag was shared, silently truncated the next test's stream and turned a
/// clean failure into an out-of-range crash.
final class StreamingStub: URLProtocol {
    static var chunks: [String] = []
    static var status = 200
    static var stopCount = 0

    private let stopped = Stopped()

    final class Stopped {
        private let lock = NSLock()
        private var value = false
        var isSet: Bool {
            lock.lock(); defer { lock.unlock() }
            return value
        }
        func set() {
            lock.lock(); defer { lock.unlock() }
            value = true
        }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: Self.status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "text/event-stream"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)

        // Strong `self` on purpose. URLSession does not promise to keep a
        // protocol instance alive past `startLoading()` returning, and with a
        // weak capture this block woke up to a nil self and delivered nothing
        // — every test after the first one saw an empty stream. The instance
        // is the thing doing the work, so it holds itself up until done.
        let stopped = self.stopped
        DispatchQueue.global().async {
            for chunk in Self.chunks {
                if stopped.isSet { return }
                self.client?.urlProtocol(self, didLoad: Data(chunk.utf8))
                Thread.sleep(forTimeInterval: 0.03)
            }
            if !stopped.isSet { self.client?.urlProtocolDidFinishLoading(self) }
        }
    }

    override func stopLoading() {
        stopped.set()
        Self.stopCount += 1
    }
}

final class EventStreamTests: XCTestCase {
    var session: URLSession!

    override func setUp() {
        super.setUp()
        StreamingStub.chunks = []
        StreamingStub.status = 200
        StreamingStub.stopCount = 0
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StreamingStub.self]
        session = URLSession(configuration: configuration)
    }

    override func tearDown() {
        session?.invalidateAndCancel()
        session = nil
        super.tearDown()
    }

    private var request: URLRequest {
        URLRequest(url: URL(string: "http://127.0.0.1:8800/api/events")!)
    }

    private func collect(limit: Int) async throws -> [StreamFrame] {
        var frames: [StreamFrame] = []
        for try await frame in eventStream(request: request, session: session) {
            frames.append(frame)
            if frames.count >= limit { break }
        }
        return frames
    }

    func testDeliversEveryFrameAsItArrives() async throws {
        StreamingStub.chunks = [
            "data: {\"kind\":\"hello\",\"cursor\":\"abc12345:0\",\"resumed\":false}\n\n",
            ": keepalive\n\n",
            "id: abc12345:1\ndata: {\"kind\":\"bot\",\"seq\":1,\"bot\":{\"id\":\"b1\",\"threadId\":\"t1\",\"name\":\"Scout\",\"title\":\"\",\"description\":\"\",\"notifications\":true,\"color\":\"green\",\"unread\":false,\"modelSelection\":{\"instanceId\":\"i\",\"model\":\"m\"},\"createdAt\":1}}\n\n",
            "id: abc12345:2\ndata: {\"kind\":\"message\",\"seq\":2,\"threadId\":\"t1\",\"message\":{\"id\":\"m1\",\"role\":\"user\",\"kind\":\"text\",\"at\":1,\"text\":\"hi\"}}\n\n",
        ]

        let frames = try await collect(limit: 3)

        guard frames.count == 3 else {
            return XCTFail("expected 3 frames, got \(frames.count) — the stream stopped early")
        }
        guard case .hello = frames[0].frame else { return XCTFail("expected hello first") }
        guard case .bot = frames[1].frame else { return XCTFail("expected bot") }
        guard case .message = frames[2].frame else { return XCTFail("expected message") }
        XCTAssertEqual(frames[2].seq, 2)
    }

    func testSurvivesAFrameSplitAcrossReads() async throws {
        StreamingStub.chunks = [
            "data: {\"kind\":\"hel",
            "lo\",\"cursor\":\"abc12345:0\",\"resumed\":true}",
            "\n\n",
        ]
        let frames = try await collect(limit: 1)
        guard case let .hello(cursor, resumed) = frames.first?.frame else {
            return XCTFail("expected a hello reassembled from three reads")
        }
        XCTAssertEqual(cursor, "abc12345:0")
        XCTAssertTrue(resumed)
    }

    func testReportsAnUnauthorizedStreamRatherThanEndingQuietly() async {
        StreamingStub.status = 401
        StreamingStub.chunks = ["{\"error\":\"pair this device\"}"]
        do {
            _ = try await collect(limit: 1)
            XCTFail("a 401 must surface, not look like an empty stream")
        } catch let error as APIError {
            XCTAssertTrue(error.isUnauthorized)
        } catch {
            XCTFail("expected an APIError, got \(error)")
        }
    }

    func testCancellingTheConsumerTearsDownTheRequest() async throws {
        StreamingStub.chunks = [
            "data: {\"kind\":\"hello\",\"cursor\":\"abc12345:0\",\"resumed\":false}\n\n",
            "data: {\"kind\":\"config\",\"seq\":1}\n\n",
            "data: {\"kind\":\"config\",\"seq\":2}\n\n",
        ]
        let frames = try await collect(limit: 1)
        XCTAssertEqual(frames.count, 1, "the stream should have delivered its first frame")
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertGreaterThan(StreamingStub.stopCount, 0, "leaving the stream should cancel the request")
    }
}
