// Modified for StartupBot; original copyright and license retained.
import Foundation
import CompanionCore

extension MausState {
    private static let legacy: [String: MausState] = [
        "deadpan": .idle, "friendly": .happy, "focused": .working, "thinking": .thinking,
        "excited": .excited, "sleepy": .drowsy, "surprised": .surprised, "skeptical": .suspicious,
        "worried": .scared, "mischievous": .playful,
    ]

    static func normalize(_ value: String?) -> MausState? {
        guard let value, !value.isEmpty else { return nil }
        return MausState(rawValue: value) ?? legacy[value]
    }

    static func forBot(_ bot: Bot, last: Message?) -> MausState {
        if let pinned = normalize(bot.mascotExpression) { return pinned }

        if last?.kind == .activity, last?.tool?.ok == false { return .alerting }
        if bot.busy == true { return .working }
        if bot.unread { return .notifying }
        if last?.kind == .options { return .curious }

        let profile = "\(bot.name) \(bot.title) \(bot.description)".lowercased()
        func matches(_ words: [String]) -> Bool {
            words.contains { word in
                profile.range(of: "\\b\(NSRegularExpression.escapedPattern(for: word))\\b", options: .regularExpression) != nil
            }
        }
        if matches(["code", "coding", "developer", "development", "engineer", "engineering", "build", "debug", "program", "software"]) { return .working }
        if matches(["research", "researcher", "search", "investigate", "strategy", "strategist", "study", "learn", "knowledge"]) { return .searching }
        if matches(["marketing", "growth", "launch", "campaign", "social", "sales", "outreach", "brand"]) { return .excited }
        if matches(["overnight", "night", "background", "async", "queue", "batch", "long-running"]) { return .drowsy }
        if matches(["monitor", "monitoring", "incident", "alert", "watch", "status", "uptime"]) { return .radar }
        if matches(["review", "reviewer", "audit", "critic", "critique", "quality", "qa", "test", "legal"]) { return .suspicious }
        if matches(["security", "secure", "compliance", "risk", "privacy", "finance", "financial"]) { return .scared }
        if matches(["design", "designer", "creative", "brainstorm", "art", "illustration", "music", "story"]) { return .playful }
        if matches(["support", "help", "success", "onboarding", "coach", "teacher", "guide", "welcome"]) { return .happy }
        return .idle
    }

    static func forChat(_ chat: Chat, in state: CompanionState) -> MausState {
        switch chat {
        case let .bot(bot): return forBot(bot, last: state.visibleTranscript(forThread: bot.threadId).last)
        case .room: return .happy
        }
    }
}
