// Modified for StartupBot; original copyright and license retained.
import ActivityKit
import Combine
import Foundation
import CompanionCore

@MainActor
final class LiveActivityCoordinator {
    private var activeConnectionID: String?
    private var cancellable: AnyCancellable?
    private var lastSent: [String: BotActivityAttributes.ContentState] = [:]
    private var since: [String: (kind: String, at: Date)] = [:]

    func attach(to session: Session) {
        AnswerApprovalIntent.handler = { [weak self, weak session] connectionID, threadId, requestId, choice, isPermission in
            await self?.answer(session: session, connectionID: connectionID, threadId: threadId, requestId: requestId, choice: choice, isPermission: isPermission)
        }
        cancellable = session.$state.combineLatest(session.$connection)
            .debounce(for: .milliseconds(400), scheduler: DispatchQueue.main)
            .sink { [weak self] value in self?.sync(value.0, connectionID: value.1?.id) }
    }

    private func answer(session: Session?, connectionID: String?, threadId: String, requestId: String, choice: String, isPermission: Bool) async {
        guard let connectionID, !connectionID.isEmpty, session?.connection?.id == connectionID,
              Activity<BotActivityAttributes>.activities.contains(where: {
            $0.attributes.connectionID == connectionID && $0.content.state.canAnswer(connectionID: connectionID, threadId: threadId, requestId: requestId, choice: choice, isPermission: isPermission)
        }) else {
            session?.actionError = AppLanguage.message("This request has changed. Open the chat to review it.")
            return
        }
        await session?.answer(threadId: threadId, requestId: requestId, choice: choice, isPermission: isPermission, originConnectionID: connectionID)
    }

    private func sync(_ state: CompanionState, connectionID: String?) {
        if activeConnectionID != connectionID {
            lastSent.removeAll()
            since.removeAll()
            activeConnectionID = connectionID
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let wanted = connectionID == nil ? [] : state.liveActivityUpdates
        var wantedIds = Set<String>()

        for update in wanted {
            guard case let .bot(bot) = update.chat else { continue }
            wantedIds.insert(bot.id)
            let face = MausState.forBot(bot, last: state.visibleTranscript(forThread: bot.threadId).last)
            let kind = update.kind == .needsYou ? "needsYou" : "working"
            if since[bot.id]?.kind != kind { since[bot.id] = (kind, Date()) }
            let content = BotActivityAttributes.ContentState(
                face: face.rawValue,
                kind: update.kind == .needsYou ? "needsYou" : "working",
                headline: update.kind == .needsYou ? "\(bot.name) needs you" : "\(bot.name) is working",
                line: update.line.isEmpty ? (update.card?.title ?? "") : update.line,
                threadId: update.chat.threadId,
                connectionID: connectionID,
                card: update.card?.questionRequest == nil ? update.card : nil,
                since: since[bot.id]?.at ?? Date()
            )
            if lastSent[bot.id] == content { continue }
            defer { lastSent[bot.id] = content }

            let alert: AlertConfiguration? = update.kind == .needsYou
                ? AlertConfiguration(
                    title: LocalizedStringResource(stringLiteral: content.headline),
                    body: LocalizedStringResource(stringLiteral: content.line),
                    sound: .default
                )
                : nil
            if let activity = Activity<BotActivityAttributes>.activities.first(where: { $0.attributes.botId == bot.id && $0.attributes.connectionID == connectionID }) {
                let newAsk = update.kind == .needsYou && (
                    lastSent[bot.id]?.threadId != content.threadId || lastSent[bot.id]?.requestId != content.requestId
                )
                Task { await activity.update(.init(state: content, staleDate: nil), alertConfiguration: newAsk ? alert : nil) }
            } else {
                let attributes = BotActivityAttributes(connectionID: connectionID, botId: bot.id, threadId: bot.threadId, name: bot.name, color: bot.color)
                _ = try? Activity.request(attributes: attributes, content: .init(state: content, staleDate: nil), pushType: nil)
                if let alert, let activity = Activity<BotActivityAttributes>.activities.first(where: { $0.attributes.botId == bot.id && $0.attributes.connectionID == connectionID }) {
                    Task { await activity.update(.init(state: content, staleDate: nil), alertConfiguration: alert) }
                }
            }
        }

        for activity in Activity<BotActivityAttributes>.activities where activity.attributes.connectionID != connectionID || !wantedIds.contains(activity.attributes.botId) {
            lastSent.removeValue(forKey: activity.attributes.botId)
            since.removeValue(forKey: activity.attributes.botId)
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
    }
}
