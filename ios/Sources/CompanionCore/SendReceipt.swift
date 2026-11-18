// Modified for StartupBot; original copyright and license retained.
import Foundation

public enum SendReceipt: Hashable, Sendable {
    /// In the transcript now. `steered` means it went into a turn that was
    /// already running rather than starting one.
    case sent(threadId: String?, steered: Bool)
    /// Held in the harness's steer queue until the current turn settles.
    case queued(queueId: String, threadId: String)

    public var queued: (queueId: String, threadId: String)? {
        guard case let .queued(queueId, threadId) = self else { return nil }
        return (queueId, threadId)
    }
}

/// The 202 body, read leniently. Every field is optional on purpose: a
/// harness older than this app answers `{ok:true}` and nothing else, and
/// that is a plain send, not a failure.
struct SendReceiptBody: Decodable {
    var threadId: String?
    var queued: Bool?
    var queueId: String?
    var steered: Bool?

    var receipt: SendReceipt {
        if queued == true, let queueId, let threadId {
            return .queued(queueId: queueId, threadId: threadId)
        }
        return .sent(threadId: threadId, steered: steered == true)
    }
}
