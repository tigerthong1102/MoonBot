// Modified for StartupBot; original copyright and license retained.
import Foundation

public struct BotActivityContent: Codable, Hashable, Sendable {
    public var face: String
    public var kind: String
    public var headline: String
    public var line: String
    /// Non-secret paired-computer identity. Unscoped content cannot authorize an answer.
    public var connectionID: String?
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
        self.options = card?.isPending == true && card?.skillRequest == nil ? (card?.options ?? []) : []
        self.isPermission = card?.isPermission ?? false
        self.since = since
    }

    public var approvalThreadId: String? {
        guard let connectionID, !connectionID.isEmpty, kind == "needsYou", let threadId, !threadId.isEmpty,
              let requestId, !requestId.isEmpty, !options.isEmpty else { return nil }
        return threadId
    }

    public func canAnswer(connectionID: String?, threadId: String, requestId: String, choice: String, isPermission: Bool) -> Bool {
        connectionID != nil && connectionID == self.connectionID
            && approvalThreadId == threadId && self.requestId == requestId
            && options.contains(choice) && self.isPermission == isPermission
    }
}
