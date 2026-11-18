// Modified for StartupBot; original copyright and license retained.
// The SSE parser, which is where a hand-rolled event client goes wrong.
import XCTest
@testable import CompanionCore

final class SSETests: XCTestCase {
    func events(_ lines: [String]) -> [SSEEvent] {
        var parser = SSEParser()
        return lines.compactMap { parser.line($0) }
    }

    func testReadsOneFrameTheHarnessActuallySends() {
        let parsed = events(["id: 778d5d30:4", #"data: {"kind":"bot","seq":4}"#, ""])
        XCTAssertEqual(parsed.count, 1)
        XCTAssertEqual(parsed[0].id, "778d5d30:4")
        XCTAssertEqual(parsed[0].data, #"{"kind":"bot","seq":4}"#)
    }

    func testSwallowsKeepaliveComments() {
        XCTAssertTrue(events([": keepalive", ""]).isEmpty)
        let parsed = events([": keepalive", "", "data: {}", ""])
        XCTAssertEqual(parsed.count, 1)
    }

    func testEmitsNothingUntilTheBlankLineArrives() {
        var parser = SSEParser()
        XCTAssertNil(parser.line("id: s:1"))
        XCTAssertNil(parser.line("data: {}"))
        XCTAssertNotNil(parser.line(""))
    }

    func testJoinsMultipleDataLines() {
        let parsed = events(["data: {", #"data: "kind": "hello""#, "data: }", ""])
        XCTAssertEqual(parsed.first?.data, "{\n\"kind\": \"hello\"\n}")
    }

    func testHandlesTheOptionalSpaceAndCarriageReturns() {
        XCTAssertEqual(events(["data:tight", ""]).first?.data, "tight")
        XCTAssertEqual(events(["data:  padded", ""]).first?.data, " padded", "only one space is the separator")
        XCTAssertEqual(events(["data: crlf\r", "\r"]).first?.data, "crlf")
    }

    func testIgnoresFieldsItDoesNotUseAndBlocksWithoutData() {
        XCTAssertTrue(events(["event: ping", "retry: 3000", ""]).isEmpty)
        XCTAssertTrue(events(["", "", ""]).isEmpty)
        XCTAssertTrue(events(["garbage-with-no-colon", ""]).isEmpty)
    }

    func testDoesNotLeakFieldsFromOneEventIntoTheNext() {
        var parser = SSEParser()
        _ = parser.line("id: s:1")
        _ = parser.line("data: first")
        let first = parser.line("")
        _ = parser.line("data: second")
        let second = parser.line("")

        XCTAssertEqual(first?.id, "s:1")
        XCTAssertEqual(second?.data, "second")
        XCTAssertNil(second?.id, "the second event never carried an id")
    }

    func testAFullStreamDecodesIntoFrames() throws {
        let lines = [
            #"data: {"kind":"hello","cursor":"abc12345:0","resumed":false}"#, "",
            ": keepalive", "",
            "id: abc12345:1",
            #"data: {"kind":"message","threadId":"t1","seq":1,"message":{"id":"m1","role":"user","kind":"text","at":1}}"#,
            "",
        ]
        let decoder = JSONDecoder()
        let frames = events(lines).compactMap { event in
            try? decoder.decode(StreamFrame.self, from: Data(event.data.utf8))
        }
        XCTAssertEqual(frames.count, 2)
        guard case let .hello(cursor, resumed) = frames[0].frame else { return XCTFail("expected hello") }
        XCTAssertEqual(cursor, "abc12345:0")
        XCTAssertFalse(resumed)
        guard case .message = frames[1].frame else { return XCTFail("expected message") }
        XCTAssertEqual(frames[1].seq, 1)
    }
}
