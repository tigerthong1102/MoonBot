public struct AiTwinStatus: Decodable, Sendable {
    public let twin: AiTwinProfile?
    public let preview: AiTwinProvider?
}

public struct AiTwinProfile: Decodable, Sendable {
    public let id: String
    public let name: String
    public let revision: Int
    public let paused: Bool
}

public struct AiTwinProvider: Decodable, Sendable {
    public let key: String
    public let name: String
    public let model: String
}

public struct AiTwinAnswer: Decodable, Sendable {
    public let lesson: Lesson?
    public let draft: String?
    public let match: String?

    public struct Lesson: Decodable, Sendable {
        public let question: String
        public let answer: String
    }

    init() {
        lesson = nil
        draft = nil
        match = nil
    }
}

public enum AiTwinAction: Equatable, Sendable {
    case exact, semantic, draft
}
