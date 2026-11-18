// Modified for StartupBot; original copyright and license retained.
import Foundation
import CompanionCore

struct ChatUpdate: Identifiable, Hashable {
    enum Kind: Int, Comparable {
        case needsYou = 0, working, toReview
        static func < (a: Kind, b: Kind) -> Bool { a.rawValue < b.rawValue }
    }

    let chat: Chat
    let kind: Kind
    let line: String
    let card: OptionCard?

    var id: String { chat.conversationID }
}

extension CompanionState {
    var liveActivityUpdates: [ChatUpdate] {
        var seen = Set<String>()
        return updates.filter { update in
            guard update.kind != .toReview, case let .bot(bot) = update.chat else { return false }
            return seen.insert(bot.id).inserted
        }
    }

    var updates: [ChatUpdate] {
        var out: [ChatUpdate] = []
        var seen = Set<String>()

        for pending in pendingApprovals {
            guard let chat = chat(forThread: pending.threadId), seen.insert(chat.conversationID).inserted else { continue }
            let card = pending.message.card
            out.append(ChatUpdate(chat: chat, kind: .needsYou, line: card?.subtitle ?? card?.title ?? "", card: card))
        }

        for bot in bots where bot.hidden != true {
            for task in bot.threadGroups().flatMap(\.tasks) {
                guard let projected = bot.projected(forThread: task.threadId) else { continue }
                let chat = Chat.bot(projected)
                guard seen.insert(chat.conversationID).inserted else { continue }
                if task.activity == "waiting-on-you" {
                    out.append(ChatUpdate(chat: chat, kind: .needsYou, line: "Waiting on you", card: nil))
                } else if task.activity == "queued" || projected.busy == true {
                    out.append(ChatUpdate(chat: chat, kind: .working,
                        line: task.activity == "queued" ? "Queued — waiting for an available slot" : workingLine(threadId: task.threadId), card: nil))
                } else if projected.unread {
                    out.append(ChatUpdate(chat: chat, kind: .toReview, line: lastLine(threadId: task.threadId), card: nil))
                }
            }
        }
        for room in rooms {
            let threads = room.tasks?.map(\.threadId) ?? [room.threadId]
            for thread in threads {
                guard let projected = room.projected(forThread: thread) else { continue }
                let chat = Chat.room(projected)
                guard seen.insert(chat.conversationID).inserted else { continue }
                if projected.busyBotId != nil {
                    out.append(ChatUpdate(chat: chat, kind: .working, line: workingLine(threadId: thread), card: nil))
                } else if projected.unread {
                    out.append(ChatUpdate(chat: chat, kind: .toReview, line: lastLine(threadId: thread), card: nil))
                }
            }
        }
        return out.sorted { $0.kind < $1.kind }
    }

    func chat(forThread threadId: String) -> Chat? {
        if let bot = bot(forThread: threadId) { return .bot(bot) }
        if let room = room(forThread: threadId) { return .room(room) }
        return nil
    }

    private func workingLine(threadId: String) -> String {
        if let live = streaming[threadId], !live.isEmpty {
            return String(live.suffix(120)).replacingOccurrences(of: "\n", with: " ")
        }
        if let last = visibleTranscript(forThread: threadId).last, last.kind == .activity, let tool = last.tool {
            return tool.name
        }
        return "Working…"
    }

    private func lastLine(threadId: String) -> String {
        guard let last = visibleTranscript(forThread: threadId).last else { return "" }
        switch last.kind {
        case .text, .unknown: return last.text ?? ""
        case .options: return last.card?.title ?? ""
        case .secret: return last.secret?.label ?? last.text ?? "Credential required"
        case .activity: return last.tool?.name ?? ""
        case .screen: return "Screenshot"
        }
    }
}
