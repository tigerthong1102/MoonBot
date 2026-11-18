import Foundation

public enum SearchHistoryCursor: Equatable, Sendable {
    case latest
    case around(String)
}

public struct SearchLanding {
    private let threadID: String
    private let messageID: String
    private let maximumPages: Int
    private let maximumBytes: Int
    private let deadline = Date().addingTimeInterval(30)
    private var pages = 1
    private var requested = Set<String>()
    private var expectedID: String

    public init(threadID: String, messageID: String, maximumPages: Int = 40, maximumBytes: Int = 8 * 1024 * 1024) {
        self.threadID = threadID
        self.messageID = messageID
        self.maximumPages = maximumPages
        self.maximumBytes = maximumBytes
        expectedID = messageID
    }

    public func merge(_ page: ThreadPage, into state: CompanionState) throws -> CompanionState {
        guard Date() < deadline, pages <= maximumPages else { throw LandingError.limit }
        guard page.messages.contains(where: { $0.id == expectedID }) else { throw LandingError.unavailable }
        var bounded = page
        bounded.activeLeafId = state.activeLeafIds[threadID] ?? state.bot(forThread: threadID)?.activeLeafId ?? page.activeLeafId
        var next = state
        next.merge(bounded, intoThread: threadID)
        guard try JSONEncoder().encode(next.transcript(forThread: threadID)).count <= maximumBytes else { throw LandingError.limit }
        return next
    }

    public mutating func next(in state: CompanionState) throws -> SearchHistoryCursor? {
        guard Date() < deadline else { throw LandingError.limit }
        let all = state.transcript(forThread: threadID)
        if let leaf = state.activeLeafIds[threadID] ?? state.bot(forThread: threadID)?.activeLeafId,
           !all.contains(where: { $0.id == leaf }) {
            guard pages < maximumPages, requested.insert(leaf).inserted else { throw LandingError.unavailable }
            pages += 1
            expectedID = leaf
            return .latest
        }
        let visible = state.visibleTranscript(forThread: threadID)
        if visible.contains(where: { $0.id == messageID }) { return nil }
        guard pages < maximumPages else { throw LandingError.limit }
        guard let parent = visible.first?.parentId, !all.contains(where: { $0.id == parent }), requested.insert(parent).inserted else {
            throw LandingError.unavailable
        }
        pages += 1
        expectedID = parent
        return .around(parent)
    }

    public enum LandingError: LocalizedError {
        case unavailable, limit
        public var errorDescription: String? {
            switch self {
            case .unavailable: "The conversation changed or its history could not be connected. Search again."
            case .limit: "The search result exceeds the history safety limit. Load older messages and try again."
            }
        }
    }
}
