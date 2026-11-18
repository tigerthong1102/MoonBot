// Modified for StartupBot; original copyright and license retained.
import XCTest
@testable import CompanionCore

final class QueuedSendTests: XCTestCase {
    private func echo() -> Bot {
        Bot(
            id: "b1", threadId: "t1", name: "Echo", title: "", description: "",
            notifications: true, color: "blue", unread: false,
            modelSelection: ModelSelection(instanceId: "codex", model: "gpt-5.5"),
            createdAt: 1
        )
    }

    private func drained(_ id: String, queueId: String, text: String = "and add tests") -> Message {
        var message = Message(id: id, role: .user, kind: .text, at: 10)
        message.text = text
        message.queueId = queueId
        return message
    }


    func testAHeldSendDecodesAsQueued() throws {
        let body = Data(#"{"ok":true,"queued":true,"queueId":"q1","threadId":"t1"}"#.utf8)
        let receipt = try JSONDecoder().decode(SendReceiptBody.self, from: body).receipt
        XCTAssertEqual(receipt, .queued(queueId: "q1", threadId: "t1"))
    }

    func testASendTakenIntoTheRunningTurnDecodesAsSteered() throws {
        let body = Data(#"{"ok":true,"steered":true,"threadId":"t1","message":{"id":"m1"}}"#.utf8)
        let receipt = try JSONDecoder().decode(SendReceiptBody.self, from: body).receipt
        XCTAssertEqual(receipt, .sent(threadId: "t1", steered: true))
    }

    func testAnAnswerWithoutMidTurnDetailIsAPlainSend() throws {
        let body = Data(#"{"ok":true}"#.utf8)
        let receipt = try JSONDecoder().decode(SendReceiptBody.self, from: body).receipt
        XCTAssertEqual(receipt, .sent(threadId: nil, steered: false))
    }

    func testQueuedWithoutAnIdFallsBackToAPlainSend() throws {
        let body = Data(#"{"ok":true,"queued":true,"threadId":"t1"}"#.utf8)
        let receipt = try JSONDecoder().decode(SendReceiptBody.self, from: body).receipt
        XCTAssertEqual(receipt, .sent(threadId: "t1", steered: false))
    }


    func testAHeldSendStaysOnScreenUntilItsLineLands() {
        var state = CompanionState()
        state.rememberQueued(QueuedSend(queueId: "q1", text: "and add tests"), inThread: "t1")
        XCTAssertEqual(state.pendingQueued["t1"]?.map(\.text), ["and add tests"])

        state.apply(.message(threadId: "t1", message: drained("m1", queueId: "q1")))
        XCTAssertNil(state.pendingQueued["t1"])
        XCTAssertEqual(state.transcript(forThread: "t1").count, 1)
    }

    func testHoldsAreKeptInSendOrderAndNeverTwice() {
        var state = CompanionState()
        state.rememberQueued(QueuedSend(queueId: "q1", text: "first"), inThread: "t1")
        state.rememberQueued(QueuedSend(queueId: "q2", text: "second"), inThread: "t1")
        state.rememberQueued(QueuedSend(queueId: "q1", text: "first"), inThread: "t1")
        XCTAssertEqual(state.pendingQueued["t1"]?.map(\.text), ["first", "second"])
    }

    func testADrainThatBeatsItsOwnReceiptDoesNotResurrectTheGhost() {
        var state = CompanionState()
        state.apply(.message(threadId: "t1", message: drained("m1", queueId: "q1")))
        state.rememberQueued(QueuedSend(queueId: "q1", text: "and add tests"), inThread: "t1")
        XCTAssertNil(state.pendingQueued["t1"])
    }

    func testTheTombstoneIsSpentOnce() {
        var state = CompanionState()
        state.apply(.message(threadId: "t1", message: drained("m1", queueId: "q1")))
        state.rememberQueued(QueuedSend(queueId: "q1", text: "first"), inThread: "t1")
        state.rememberQueued(QueuedSend(queueId: "q1", text: "first"), inThread: "t1")
        XCTAssertEqual(state.pendingQueued["t1"]?.map(\.text), ["first"])
    }

    func testCancellingAHoldRemovesItAndOnlyIt() {
        var state = CompanionState()
        state.rememberQueued(QueuedSend(queueId: "q1", text: "first"), inThread: "t1")
        state.rememberQueued(QueuedSend(queueId: "q2", text: "second"), inThread: "t1")
        state.forgetQueued("q1", inThread: "t1")
        XCTAssertEqual(state.pendingQueued["t1"]?.map(\.text), ["second"])
        state.forgetQueued("q2", inThread: "t1")
        XCTAssertNil(state.pendingQueued["t1"])
    }

    func testAPageThatAlreadyContainsTheLineRetiresItsGhost() {
        var state = CompanionState()
        state.rememberQueued(QueuedSend(queueId: "q1", text: "and add tests"), inThread: "t1")
        state.merge(
            ThreadPage(messages: [drained("m1", queueId: "q1")], hasMore: false),
            intoThread: "t1"
        )
        XCTAssertNil(state.pendingQueued["t1"])
    }

    func testHoldsAreKeptPerThread() {
        var state = CompanionState()
        state.rememberQueued(QueuedSend(queueId: "q1", text: "first"), inThread: "t1")
        state.rememberQueued(QueuedSend(queueId: "q2", text: "second"), inThread: "t2")
        state.apply(.message(threadId: "t1", message: drained("m1", queueId: "q1")))
        XCTAssertNil(state.pendingQueued["t1"])
        XCTAssertEqual(state.pendingQueued["t2"]?.map(\.text), ["second"])
    }

    func testAWholesaleTranscriptReplacementRetiresTheGhost() {
        var state = CompanionState()
        var bot = echo()
        state.apply(.bot(bot))
        state.rememberQueued(QueuedSend(queueId: "q1", text: "Count to 5"), inThread: "t1")
        XCTAssertEqual(state.pendingQueued["t1"]?.count, 1)

        bot.messages = [drained("m1", queueId: "q1")]
        state.apply(.bot(bot))
        XCTAssertNil(state.pendingQueued["t1"])
    }

    func testAnIdleBotHasNothingStreaming() {
        var state = CompanionState()
        var bot = echo()
        bot.busy = true
        state.apply(.bot(bot))
        state.apply(.runtime(RuntimeEvent(
            type: "content.delta", threadId: "t1", delta: "A History of Comp", streamKind: "assistant_text"
        )))
        XCTAssertFalse((state.streaming["t1"] ?? "").isEmpty)

        bot.busy = false
        state.apply(.bot(bot))
        XCTAssertNil(state.streaming["t1"])
    }

    func testOnlyTheHarnessesOwn404CountsAsAlreadyGone() {
        let drained = APIError.status(code: 404, message: CompanionClient.alreadyDrained)
        let noRoute = APIError.status(code: 404, message: "no route: DELETE /api/bots/b1/queue/q1")
        XCTAssertTrue(isAlreadyDrained(drained))
        XCTAssertFalse(isAlreadyDrained(noRoute))
        XCTAssertFalse(isAlreadyDrained(APIError.status(code: 404, message: nil)))
    }

    private func isAlreadyDrained(_ error: APIError) -> Bool {
        guard case let .status(code, message) = error else { return false }
        return code == 404
            && message?.localizedCaseInsensitiveContains(CompanionClient.alreadyDrained) == true
    }


    func testATranscriptLineCarriesItsMidTurnMarkers() throws {
        let body = Data(#"""
        {"id":"m1","role":"user","kind":"text","at":1,"text":"stop and explain","steered":true}
        """#.utf8)
        let message = try JSONDecoder().decode(Message.self, from: body)
        XCTAssertEqual(message.steered, true)
        XCTAssertNil(message.queueId)
    }

    func testAnEngineThatCanTakeWordsIntoATurnSaysSo() throws {
        let body = Data(#"{"effortLevels":["low"],"queueing":true}"#.utf8)
        let capabilities = try JSONDecoder().decode(InstanceCapabilities.self, from: body)
        XCTAssertEqual(capabilities.queueing, true)
    }
}
