// Modified for StartupBot; original copyright and license retained.
import SwiftUI
import CompanionCore

enum IslandGeometry {
    static let size = CGSize(width: 126, height: 37)
    static let top: CGFloat = 11

    static func hasIsland(topInset: CGFloat) -> Bool { topInset >= 54 }

    static var topInset: CGFloat {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first?.safeAreaInsets.top ?? 0
    }
}

struct IslandShell<Content: View>: View {
    let expanded: Bool
    let hasIsland: Bool
    var expandedSize = CGSize(width: 250, height: 330)
    @ViewBuilder let content: () -> Content

    var body: some View {
        let size = expanded ? expandedSize : IslandGeometry.size
        ZStack(alignment: .top) {
            RoundedRectangle(cornerRadius: expanded ? 56 : IslandGeometry.size.height / 2, style: .continuous)
                .fill(Color.black)
                .overlay(
                    RoundedRectangle(cornerRadius: expanded ? 56 : IslandGeometry.size.height / 2, style: .continuous)
                        .strokeBorder(Color.white.opacity(expanded ? 0.12 : 0), lineWidth: 1)
                )
            if expanded {
                content()
                    .frame(width: expandedSize.width, height: expandedSize.height)
                    .transition(.opacity.combined(with: .scale(scale: 0.92)))
            }
        }
        .frame(width: size.width, height: size.height)
        .clipShape(RoundedRectangle(cornerRadius: expanded ? 56 : IslandGeometry.size.height / 2, style: .continuous))
        .opacity(expanded || hasIsland ? 1 : 0)
        .scaleEffect(expanded || hasIsland ? 1 : 0.6, anchor: .top)
        .padding(.top, IslandGeometry.top)
        .shadow(color: .black.opacity(expanded ? 0.45 : 0), radius: 28, y: 12)
        .ignoresSafeArea(edges: .top)
    }
}

struct NeedsYouIsland: View {
    let update: ChatUpdate?
    let hasIsland: Bool
    let open: (Chat) -> Void
    @EnvironmentObject private var session: Session
    @State private var shown: ChatUpdate?
    @State private var dismissedCardIds = Set<String>()
    @State private var answering = false
    @State private var attentionLive = true

    private var expanded: Bool { shown != nil }

    var body: some View {
        ZStack(alignment: .top) {
            if expanded {
                Color.black.opacity(0.001)
                    .ignoresSafeArea()
                    .onTapGesture { dismiss() }
            }
            IslandShell(expanded: expanded, hasIsland: hasIsland) {
                if let shown {
                    VStack(spacing: 10) {
                        Button { open(shown.chat) } label: {
                            ChatAvatarView(chat: shown.chat, size: 120, state: MausState.forChat(shown.chat, in: session.state), animated: attentionLive, comets: attentionLive)
                        }
                        .buttonStyle(.plain)
                        .task(id: shown.chat.conversationID) {
                            attentionLive = true
                            try? await Task.sleep(for: .seconds(30))
                            attentionLive = false
                        }
                        .padding(.top, IslandGeometry.size.height + 14)

                        VStack(spacing: 4) {
                            Label("\(shown.chat.name) needs you", systemImage: "hand.raised.fill")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(MausPalette.color(shown.chat.color))
                            Text(shown.line.isEmpty ? (shown.card?.title ?? "") : shown.line)
                                .font(.system(size: 15))
                                .foregroundStyle(.white)
                                .multilineTextAlignment(.center)
                                .lineLimit(3)
                                .padding(.horizontal, 20)
                        }

                        if let card = shown.card, card.isPending {
                            Group {
                                if card.skillRequest != nil || card.questionRequest != nil {
                                    Button {
                                        open(shown.chat)
                                        dismiss()
                                    } label: {
                                        Label(card.questionRequest != nil ? LocalizedStringKey("Open chat to answer") : LocalizedStringKey("Open chat to review"), systemImage: "doc.text.magnifyingglass")
                                            .font(.system(size: 14, weight: .semibold))
                                            .foregroundStyle(.white)
                                            .frame(maxWidth: .infinity)
                                            .frame(height: 40)
                                            .background(Capsule().fill(MausPalette.color(shown.chat.color)))
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityIdentifier(card.questionRequest != nil ? "question-open-chat" : "skill-open-chat")
                                } else {
                                    HStack(spacing: 8) {
                                        ForEach(card.options, id: \.self) { option in
                                            Button {
                                                Haptics.selection()
                                                answering = true
                                                Task {
                                                    await session.answer(chat: shown.chat, card: card, choice: option)
                                                    answering = false
                                                    dismiss()
                                                }
                                            } label: {
                                                Text(option)
                                                    .font(.system(size: 15, weight: .semibold))
                                                    .foregroundStyle(.white)
                                                    .frame(maxWidth: .infinity)
                                                    .frame(height: 40)
                                                    .background(
                                                        Capsule().fill(CardStyle.isRefusal(option) ? Color.white.opacity(0.16) : MausPalette.color(shown.chat.color))
                                                    )
                                            }
                                            .buttonStyle(.plain)
                                            .disabled(answering)
                                        }
                                    }
                                }
                            }
                            .padding(.horizontal, 20)
                            .padding(.bottom, 18)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .animation(.spring(response: 0.55, dampingFraction: 0.78), value: expanded)
        .onChange(of: update?.card?.requestId) { _, _ in reconcile() }
        .onAppear { reconcile() }
    }

    private func reconcile() {
        guard let update, update.kind == .needsYou, let id = update.card?.requestId else {
            shown = nil
            return
        }
        if dismissedCardIds.contains(id) { shown = nil; return }
        shown = update
    }

    private func dismiss() {
        if let id = shown?.card?.requestId { dismissedCardIds.insert(id) }
        shown = nil
    }
}
