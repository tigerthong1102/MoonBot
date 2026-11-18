// Modified for StartupBot; original copyright and license retained.
import Foundation

public enum ActivityDetail: String, CaseIterable, Codable, Sendable {
    case full
    case reduced
    case hidden

    public var label: String {
        switch self {
        case .full: "Full"
        case .reduced: "Reduced"
        case .hidden: "Hidden"
        }
    }

    public var caption: String {
        switch self {
        case .full: "Every step a bot takes."
        case .reduced: "Steps fold into one line. Failures always show."
        case .hidden: "No activity, only messages."
        }
    }
}

public enum IslandIntro: String, CaseIterable, Codable, Sendable {
    case always
    case oncePerBot
    case never

    public var label: String {
        switch self {
        case .always: "Always"
        case .oncePerBot: "First time per bot"
        case .never: "Never"
        }
    }
}

public struct QuickReply: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var title: String
    public var prompt: String
    public var icon: String

    public init(id: String = UUID().uuidString, title: String, prompt: String, icon: String) {
        self.id = id
        self.title = title
        self.prompt = prompt
        self.icon = icon
    }

    public static let defaults: [QuickReply] = [
        QuickReply(id: "default.diff", title: "Show diff", prompt: "Show latest git diff", icon: "arrow.triangle.pull"),
        QuickReply(id: "default.tests", title: "Run tests", prompt: "Run all automated tests", icon: "checkmark.seal"),
        QuickReply(id: "default.explain", title: "Explain steps", prompt: "Explain the changes in detail", icon: "text.bubble"),
        QuickReply(id: "default.next", title: "What's next?", prompt: "What should we do next?", icon: "sparkles"),
    ]

    public static let iconChoices = [
        "sparkles", "arrow.triangle.pull", "checkmark.seal", "text.bubble",
        "hammer", "ladybug", "doc.text", "terminal",
        "paperplane", "magnifyingglass", "clock.arrow.circlepath", "list.bullet",
    ]

    public static func encode(_ replies: [QuickReply]) -> String {
        guard let data = try? JSONEncoder().encode(replies) else { return "" }
        return String(decoding: data, as: UTF8.self)
    }

    public static func decode(_ json: String) -> [QuickReply] {
        guard !json.isEmpty, let data = json.data(using: .utf8) else { return defaults }
        guard let decoded = try? JSONDecoder().decode([QuickReply].self, from: data) else { return defaults }
        let ids = decoded.map { $0.id.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard ids.allSatisfy({ !$0.isEmpty }), Set(ids).count == ids.count else { return defaults }
        return decoded
    }
}

public enum TranscriptRow: Identifiable, Hashable, Sendable {
    case message(Message)
    case activityRun([Message])

    public var head: Message {
        switch self {
        case let .message(message): message
        case let .activityRun(items): items[0]
        }
    }

    public var id: String {
        switch self {
        case let .message(message): message.id
        case let .activityRun(items): "run.\(items[0].id)"
        }
    }

    public var at: Double { head.at }
    public var endAt: Double {
        switch self {
        case let .message(message): message.at
        case let .activityRun(items): items.last?.at ?? head.at
        }
    }
    public var role: Message.Role { head.role }
    public var kind: Message.Kind { head.kind }
    public var senderName: String? { head.from?.name }
}

public func rosterPreview(_ messages: [Message], detail: ActivityDetail) -> String {
    guard let last = transcriptRows(messages, detail: detail).last else { return "" }
    switch last {
    case let .message(message):
        return previewText(of: message)
    case let .activityRun(items):
        let running = items.contains { $0.tool?.ok == nil }
        return "\(running ? "Running" : "Ran") \(items.count) steps"
    }
}

func previewText(of message: Message) -> String {
    switch message.kind {
    case .text: return message.text ?? ""
    case .options:
        guard let card = message.card else { return "" }
        return card.isPending && !card.subtitle.isEmpty ? card.subtitle : card.title
    case .secret:
        return message.secret?.label ?? message.text ?? "Credential required"
    case .activity: return message.tool?.name ?? ""
    case .screen: return "Screenshot"
    case .unknown: return message.text ?? ""
    }
}

public func transcriptRows(_ messages: [Message], detail: ActivityDetail) -> [TranscriptRow] {
    switch detail {
    case .full:
        return messages.map(TranscriptRow.message)
    case .hidden:
        return messages.filter { $0.kind != .activity }.map(TranscriptRow.message)
    case .reduced:
        var rows: [TranscriptRow] = []
        var run: [Message] = []

        func flush() {
            if run.count > 1 {
                rows.append(.activityRun(run))
            } else {
                rows.append(contentsOf: run.map(TranscriptRow.message))
            }
            run.removeAll()
        }

        for message in messages {
            guard message.kind == .activity else {
                flush()
                rows.append(.message(message))
                continue
            }
            if message.tool?.ok == false {
                flush()
                rows.append(.message(message))
                continue
            }
            run.append(message)
        }
        flush()
        return rows
    }
}
