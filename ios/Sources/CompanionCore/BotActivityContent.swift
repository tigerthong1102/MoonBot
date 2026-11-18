// Modified for StartupBot; original copyright and license retained.
import Foundation

/// Mutable Live Activity state shared by the app and widget. An activity is
/// per bot, but its current request may belong to any of that bot's threads.
public struct BotActivityContent: Codable, Hashable, Sendable {
    public var face: String
    public var kind: String
    public var headline: String
    public var line: String
    /// Non-secret paired-computer identity. Unscoped content cannot authorize an answer.
    public var connectionID: String?
    /// Never fall back to the activity's immutable, original thread.
    public var threadId: String?
    public var requestId: String?
    public var options: [String]
    public var isPermission: Bool
    public var since: Date

    public init(
        face: String,
        kind: String,
        headline: String,
        line: String,
        threadId: String,
        connectionID: String? = nil,
        card: OptionCard?,
        since: Date
    ) {
        self.face = face
        self.kind = kind
        self.headline = headline
        self.line = line
        self.threadId = threadId
        self.connectionID = connectionID
        self.requestId = card?.isPending == true ? card?.requestId : nil
        // Compact surfaces cannot show the reviewed SKILL.md. Keep the
        // alert, but require opening chat before answering a skill request.
        self.options = card?.isPending == true && card?.skillRequest == nil ? (card?.options ?? []) : []
        self.isPermission = card?.isPermission ?? false
        self.since = since
    }

    /// The widget and intent handler use the same exact request target.
    /// Legacy content can remain visible, but cannot offer approval buttons.
    public var approvalThreadId: String? {
        guard let connectionID, !connectionID.isEmpty, kind == "needsYou", let threadId, !threadId.isEmpty,
              let requestId, !requestId.isEmpty, !options.isEmpty else { return nil }
        return threadId
    }

    /// A rendered button can outlive the ask it displayed. Refuse stale or
    /// legacy intent payloads rather than approving another thread's request.
    public func canAnswer(connectionID: String?, threadId: String, requestId: String, choice: String, isPermission: Bool) -> Bool {
        connectionID != nil && connectionID == self.connectionID
            && approvalThreadId == threadId && self.requestId == requestId
            && options.contains(choice) && self.isPermission == isPermission
    }
}
