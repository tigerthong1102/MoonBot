// Modified for StartupBot; original copyright and license retained.
import SwiftUI
import CompanionCore
import PhotosUI
import UniformTypeIdentifiers
import ImageIO
import UIKit
import AVFoundation

struct ChatView: View {
    let chat: Chat
    @State private var selectedThreadId: String
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var draft = ""
    @State private var showingTasks = false
    @State private var showingComputer = false
    @State private var showingPlus = false
    @State private var showingProfile = false
    @State private var showCommandHUD = false
    @State private var shareFile: ShareFile?
    @State private var showingPhotoPicker = false
    @State private var showingFileImporter = false
    @State private var selectedPhotos: [PhotosPickerItem] = []
    @State private var attachments: [PendingMessageAttachment] = []
    private struct ComposerSnapshot {
        var text = ""
        var attachments: [PendingMessageAttachment] = []
        var error: String?
    }
    @State private var threadDrafts: [String: ComposerSnapshot] = [:]
    @State private var preparingAttachments = false
    @State private var sendingMessage = false
    @State private var attachmentError: String?
    @State private var openingFileName: String?
    @State private var fileOpenError: String?
    @State private var filePreview: FilePreviewItem?
    @State private var fileDownloadTask: Task<Void, Never>?
    @State private var fileDownloadRequestID: UUID?
    @State private var threadOpenTask: Task<Void, Never>?
    @State private var acceptsNextHardwareLineBreak = false
    private var steerSettled: Bool { queuedSends.isEmpty || !current.busy }

    @State private var steering = false
    @FocusState private var composerFocused: Bool
    @StateObject private var dictation = SpeechDictation()
    @State private var islandExpanded = false
    @State private var islandVisible = false
    @State private var facePhase: CGFloat = 0

    @AppStorage(PrefKey.islandIntro) private var islandIntro = IslandIntro.oncePerBot.rawValue
    @AppStorage(PrefKey.islandSeen) private var islandSeen = ""
    @AppStorage(PrefKey.activityDetail) private var activityDetail = ActivityDetail.full.rawValue
    @AppStorage(PrefKey.quickReplies) private var quickReplies = ""

    init(chat: Chat) {
        self.chat = chat
        _selectedThreadId = State(initialValue: chat.threadId)
    }

    static let liveBubbleId = "companion.live"

    private var current: Chat {
        if let view = chat.projected(in: session.state, forThread: selectedThreadId) { return view }
        switch chat {
        case var .bot(bot):
            bot.threadId = selectedThreadId
            bot.busy = false
            return .bot(bot)
        case var .room(room):
            room.threadId = selectedThreadId
            room.busyBotId = nil
            room.messages = nil
            return .room(room)
        }
    }

    private var threadId: String { current.threadId }

    private var selectedThreadWasRemoved: Bool {
        chat.projected(in: session.state, forThread: selectedThreadId) == nil
    }

    private var islandIntroID: String {
        switch current {
        case let .bot(bot): "bot.\(bot.id)"
        case let .room(room): "room.\(room.id)"
        }
    }

    private var messages: [Message] {
        session.state.visibleTranscript(forThread: threadId)
    }

    private var rows: [TranscriptRow] {
        transcriptRows(messages, detail: ActivityDetail(rawValue: activityDetail) ?? .full)
    }

    private var storedChips: [ActionChipItem] {
        QuickReply.decode(quickReplies).map {
            ActionChipItem(id: $0.id, title: $0.title, icon: $0.icon, prompt: $0.prompt)
        }
    }

    private var unreadElsewhere: Int {
        let mine = current.unread ? 1 : 0
        return max(0, session.state.unreadCount - mine)
    }

    var body: some View {
        let transcript = rows
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        Color.clear.frame(height: 72)

                        if session.state.hasMore[threadId] == true {
                            Button("Load earlier messages") {
                                let anchor = transcript.first?.id
                                Task {
                                    await session.loadOlder(threadId: threadId)
                                    if let anchor { proxy.scrollTo(anchor, anchor: .top) }
                                }
                            }
                            .font(.footnote)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                        }

                        ForEach(Array(transcript.enumerated()), id: \.element.id) { index, row in
                            VStack(alignment: .leading, spacing: 6) {
                                if startsANewStretch(at: index, in: transcript) {
                                    Text(RelativeStamp.separator(row.head.date))
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundStyle(Color.secondary.opacity(0.7))
                                        .frame(maxWidth: .infinity)
                                        .padding(.top, 10)
                                        .padding(.bottom, 4)
                                }
                                switch row {
                                case let .message(message):
                                    MessageRow(
                                        chat: current,
                                        message: message,
                                        endsRun: endsRun(at: index, in: transcript),
                                        openLink: openLink,
                                        openThread: openThread
                                    )
                                case let .activityRun(items):
                                    ActivityRunChip(items: items, openThread: openThread)
                                }
                            }
                            .id(row.id)
                        }

                        if current.busy, let live = session.state.streaming[threadId], !live.isEmpty {
                            StreamingBubble(text: live, reasoning: nil, color: current.color)
                                .id(Self.liveBubbleId)
                        } else if current.busy, let thinking = session.state.reasoning[threadId], !thinking.isEmpty {
                            StreamingBubble(text: nil, reasoning: thinking, color: current.color)
                                .id(Self.liveBubbleId)
                        } else if current.busy {
                            TypingIndicatorView(tintColor: MausPalette.color(current.color))
                                .id(Self.liveBubbleId)
                                .accessibilityLabel("\(current.name) is working")
                        }

                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .frame(maxWidth: CompanionLayout.chatWidth, alignment: .leading)
                    .frame(maxWidth: .infinity)
                }
                .safeAreaInset(edge: .top, spacing: 0) { headerBar }
                .overlay(alignment: .top) { headerFace }
                .overlay(alignment: .top) {
                    let topInset = IslandGeometry.topInset
                    let hasIsland = IslandGeometry.hasIsland(topInset: topInset)
                    let islandSide: CGFloat = 220
                    let islandFaceCentre = IslandGeometry.top + IslandGeometry.size.height + (islandSide - IslandGeometry.size.height) / 2
                    let headerFaceCentre = topInset + 26
                    let faceSize = 60 + 72 * facePhase
                    let faceCentre = headerFaceCentre + (islandFaceCentre - headerFaceCentre) * facePhase
                    ZStack(alignment: .top) {
                        if islandVisible {
                            IslandShell(expanded: islandExpanded, hasIsland: hasIsland, expandedSize: CGSize(width: islandSide, height: islandSide)) {
                                Color.clear
                            }
                        }
                        ChatAvatarView(chat: current, size: faceSize, state: MausState.forChat(current, in: session.state), animated: MausState.forChat(current, in: session.state).showsActivity || islandExpanded, comets: islandExpanded)
                            .offset(y: faceCentre - faceSize / 2)
                            .allowsHitTesting(false)
                    }
                    .frame(maxWidth: .infinity, alignment: .top)
                    .ignoresSafeArea(edges: .top)
                }
                .task {
                    guard CompanionLayout.supportsIslandPresentation, !reduceMotion else { return }
                    let intro = IslandIntro(rawValue: islandIntro) ?? .oncePerBot
                    switch intro {
                    case .never:
                        return
                    case .oncePerBot:
                        guard !IslandSeen.contains(islandIntroID, in: islandSeen) else { return }
                        islandSeen = IslandSeen.adding(islandIntroID, to: islandSeen)
                    case .always:
                        break
                    }
                    islandVisible = true
                    try? await Task.sleep(for: .milliseconds(40))
                    withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) { islandExpanded = true; facePhase = 1 }
                    try? await Task.sleep(for: .milliseconds(1000))
                    withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) { islandExpanded = false; facePhase = 0 }
                    try? await Task.sleep(for: .milliseconds(600))
                    islandVisible = false
                }
                .defaultScrollAnchor(.bottom)
                .simultaneousGesture(TapGesture().onEnded {
                    if composerFocused { composerFocused = false }
                })
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: transcript.last?.id) { _, _ in
                    guard let last = transcript.last else { return }
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
                .onChange(of: session.state.streaming[threadId]?.count ?? 0) { _, length in
                    guard length > 0 else { return }
                    proxy.scrollTo(Self.liveBubbleId, anchor: .bottom)
                }
                .onChange(of: session.focusedMessageId) { _, messageId in
                    guard let messageId,
                          messages.contains(where: { $0.id == messageId })
                    else { return }
                    withAnimation { proxy.scrollTo(messageId, anchor: .center) }
                    session.consumeFocus(messageId)
                }
                .task {
                    guard let messageId = session.focusedMessageId,
                          messages.contains(where: { $0.id == messageId })
                    else { return }
                    proxy.scrollTo(messageId, anchor: .center)
                    session.consumeFocus(messageId)
                }
            }
            .id(threadId)
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            composer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .overlay(alignment: .bottom) { plusSheet }
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden(true)
        .navigationDestination(isPresented: $showingComputer) {
            if case let .bot(bot) = current { ComputerView(bot: bot) }
        }
        .task(id: threadId) {
            if selectedThreadWasRemoved { dismiss(); return }
            let openedChat = current
            await session.loadThreadIfNeeded(openedChat.threadId)
            if openedChat.unread { await session.markRead(openedChat) }
#if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-open-plus") { showingPlus = true }
            if ProcessInfo.processInfo.arguments.contains("-open-profile") { showingProfile = true }
#endif
        }
        .onChange(of: selectedThreadWasRemoved) { _, removed in
            if removed { dismiss() }
        }
        .onChange(of: session.state.hasLoadedPage(forThread: threadId)) { _, loaded in
            let requestedThread = threadId
            if !loaded { Task { await session.loadThreadIfNeeded(requestedThread) } }
        }
        .onChange(of: current.unread) { _, unread in
            let readChat = current
            if unread { Task { await session.markRead(readChat) } }
        }
        .onChange(of: threadId) { previous, next in
            dictation.stop()
            threadDrafts[previous] = ComposerSnapshot(text: draft, attachments: attachments, error: attachmentError)
            let restored = threadDrafts.removeValue(forKey: next) ?? ComposerSnapshot()
            draft = restored.text
            attachments = restored.attachments
            attachmentError = restored.error
            selectedPhotos = []
            acceptsNextHardwareLineBreak = false
            showCommandHUD = false
            showingPlus = false
            resetFilePreview()
            cancelThreadOpen()
        }
        .onChange(of: session.connection?.id) { _, _ in
            cancelThreadOpen()
        }
        .onDisappear {
            dictation.stop()
            resetFilePreview()
            cancelThreadOpen()
        }
        .onChange(of: steerSettled) { _, settled in
            if settled { steering = false }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { dictation.stop() }
        }
        .onChange(of: showingComputer) { _, shown in
            if shown { dictation.stop() }
        }
        .onChange(of: showingTasks) { _, shown in
            if shown { dictation.stop() }
        }
        .onChange(of: showingProfile) { _, shown in
            if shown { dictation.stop() }
        }
        .onChange(of: showingPlus) { _, shown in
            if shown { dictation.stop() }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey]
            let value = (raw as? NSNumber)?.uintValue ?? (raw as? UInt)
            if value == AVAudioSession.InterruptionType.began.rawValue {
                dictation.stop()
            }
        }
        .onChange(of: dictation.transcript) { _, spoken in
            draft = Dictation.draft(base: dictation.base, transcript: spoken)
        }
        .onChange(of: dictation.isListening) { _, listening in
            if listening { composerFocused = false }
        }
        .sheet(isPresented: $showingTasks) {
            if current.supportsTasks {
                TaskManagerView(chat: current) { selectedThreadId = $0 }
            }
        }
        .sheet(isPresented: $showingProfile) {
            if case let .bot(bot) = current { AgentProfileView(bot: bot) }
        }
        .sheet(item: $shareFile) { file in
            ActivityShareSheet(items: [file.url])
        }
        .photosPicker(
            isPresented: $showingPhotoPicker,
            selection: $selectedPhotos,
            maxSelectionCount: max(1, AttachmentPolicy.maximumItems - attachments.count),
            matching: .images,
            preferredItemEncoding: .current
        )
        .onChange(of: selectedPhotos) { _, items in
            guard !items.isEmpty else { return }
            Task { await importPhotos(items) }
        }
        .fileImporter(
            isPresented: $showingFileImporter,
            allowedContentTypes: [.content],
            allowsMultipleSelection: true,
            onCompletion: importFiles
        )
        .fullScreenCover(item: $filePreview) { preview in
            FilePreviewView(item: preview) {
                filePreview = nil
            }
        }
    }

    private var headerBar: some View {
        HStack(alignment: .top) {
            Button { dismiss() } label: {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 17, weight: .semibold))
                    if unreadElsewhere > 0 {
                        Text("\(unreadElsewhere)")
                            .font(.system(size: 13, weight: .semibold))
                            .padding(.horizontal, 7)
                            .frame(minWidth: 22, minHeight: 22)
                            .background(Capsule().fill(Color.secondary.opacity(0.22)))
                    }
                }
                .foregroundStyle(Color.primary)
                .padding(.leading, 12)
                .padding(.trailing, unreadElsewhere > 0 ? 8 : 12)
                .frame(height: 44)
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .glassCapsule()
            .accessibilityLabel("Back")

            Spacer(minLength: 4)

            if case .bot = current {
                GlassButton(systemImage: "display", size: 44, weight: .medium) {
                    showingComputer = true
                }
                .accessibilityLabel("Watch \(current.name)'s computer")
            } else {
                Color.clear.frame(width: 44, height: 44)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 8)
        .frame(maxWidth: CompanionLayout.headerWidth)
        .frame(maxWidth: .infinity)
        .background(
            Rectangle()
                .fill(.ultraThinMaterial)
                .mask(
                    VStack(spacing: 0) {
                        Color.black
                        LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
                            .frame(height: 20)
                    }
                )
                .padding(.bottom, -20)
                .ignoresSafeArea(edges: .top)
                .allowsHitTesting(false)
        )
    }

    private var headerFace: some View {
        VStack(spacing: 6) {
            if case .bot = current {
                Button { showingProfile = true } label: {
                    Color.clear
                        .frame(width: 60, height: 60)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .allowsHitTesting(!islandVisible)
                .accessibilityHidden(islandVisible)
                .accessibilityLabel("Open \(current.name) settings")
                .accessibilityHint("Changes this bot's model, profile, notifications, and voice")
            } else {
                Color.clear.frame(width: 60, height: 60)
            }
            Button {
                if current.supportsTasks { showingTasks = true }
                else { showingPlus = true }
            } label: {
                HStack(spacing: 6) {
                    Text(current.name)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.primary)
                        .lineLimit(1)
                    if current.supportsTasks || !current.subtitle.isEmpty {
                        Text(current.supportsTasks ? current.threadTitle : current.subtitle)
                            .font(.system(size: 13))
                            .foregroundStyle(Color.secondary)
                            .lineLimit(1)
                    }
                    Image(systemName: current.supportsTasks ? "chevron.down" : "ellipsis")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Color.secondary)
                }
                .padding(.leading, 12)
                .padding(.trailing, 10)
                .frame(height: 32)
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .glassCapsule()
            .disabled(preparingAttachments || sendingMessage)
            .accessibilityLabel(current.supportsTasks ? "Switch thread: \(current.threadTitle)" : "Open \(current.name) thread options")
            .accessibilityHint("Choose a conversation or start a new thread")
            .accessibilityIdentifier("thread-switcher")
        }
        .padding(.top, -4)
    }

    @ViewBuilder
    private var plusSheet: some View {
        if showingPlus {
            ZStack(alignment: .bottom) {
                Color.black.opacity(0.35)
                    .ignoresSafeArea()
                    .onTapGesture { withAnimation(.snappy(duration: 0.28)) { showingPlus = false } }

                VStack(spacing: 0) {
                    ForEach(plusActions) { action in
                        Button {
                            withAnimation(.snappy(duration: 0.28)) { showingPlus = false }
                            action.run()
                        } label: {
                            HStack(spacing: 16) {
                                Image(systemName: action.systemImage)
                                    .font(.system(size: 20, weight: .medium))
                                    .foregroundStyle(action.destructive ? Color.red : Color.primary)
                                    .frame(width: 44, height: 44)
                                    .background(Circle().fill(Color.primary.opacity(0.10)))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(action.title)
                                        .font(.system(size: 19, weight: .medium))
                                        .foregroundStyle(action.destructive ? Color.red : Color.primary)
                                    Text(action.subtitle)
                                        .font(.system(size: 13))
                                        .foregroundStyle(Color.secondary)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 18)
                            .frame(height: 64)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(action.disabled)
                        .opacity(action.disabled ? 0.45 : 1)
                    }
                }
                .padding(.vertical, 10)
                .frame(maxWidth: CompanionLayout.chatWidth, alignment: .leading)
                .glassSheet(cornerRadius: 30)
                .padding(.horizontal, 12)
                .padding(.bottom, 70)
                .frame(maxWidth: .infinity)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            .transition(.opacity)
        }
    }

    private struct PlusAction: Identifiable {
        let id: String
        let systemImage: String
        let title: LocalizedStringKey
        let subtitle: LocalizedStringKey
        var destructive = false
        var disabled = false
        let run: () -> Void
    }

    private var plusActions: [PlusAction] {
        let canAddAttachment = attachments.count < AttachmentPolicy.maximumItems
            && !preparingAttachments && !sendingMessage
        var out: [PlusAction] = [
            PlusAction(
                id: "photos", systemImage: "photo.on.rectangle", title: "Photo Library",
                subtitle: "Add a photo to this message", disabled: !canAddAttachment
            ) { showingPhotoPicker = true },
            PlusAction(
                id: "files", systemImage: "paperclip", title: "Choose File",
                subtitle: "Add a document from Files", disabled: !canAddAttachment
            ) { showingFileImporter = true },
        ]
        if case let .bot(bot) = current {
            out.append(PlusAction(
                id: "task", systemImage: "plus.square.on.square", title: "New thread",
                subtitle: "Start a fresh thread with \(bot.name)"
            ) { Task {
                if let created = await session.createTask(for: bot, title: nil) {
                    selectedThreadId = created.threadId
                }
            } })
            out.append(PlusAction(
                id: "tasks", systemImage: "square.stack", title: "Threads",
                subtitle: "Switch, rename or remove one"
            ) { showingTasks = true })
            out.append(PlusAction(
                id: "settings", systemImage: "gearshape", title: "Bot settings",
                subtitle: "Model, profile, voice and notifications"
            ) { showingProfile = true })
            out.append(PlusAction(
                id: "computer", systemImage: "display", title: "Watch computer",
                subtitle: "Live view of what \(bot.name) is doing"
            ) { showingComputer = true })
        }
        if case let .room(room) = current, room.dm != true {
            out.append(PlusAction(
                id: "task", systemImage: "plus.square.on.square", title: "New thread",
                subtitle: "Start a fresh conversation in \(room.name)",
                disabled: current.busy || hasPendingApproval
            ) { Task {
                if await session.createTask(for: room, title: nil),
                   let updated = session.state.rooms.first(where: { $0.id == room.id }) {
                    selectedThreadId = updated.threadId
                }
            } })
            out.append(PlusAction(
                id: "tasks", systemImage: "square.stack", title: "Threads",
                subtitle: "Switch, rename or remove one"
            ) { showingTasks = true })
        }
        out.append(PlusAction(
            id: "share", systemImage: "doc.plaintext", title: "Share transcript",
            subtitle: "This thread as Markdown"
        ) {
            Task {
                if let url = await session.export(threadId: current.threadId, format: "markdown") {
                    shareFile = ShareFile(url: url)
                }
            }
        })
        out.append(PlusAction(
            id: "share-json", systemImage: "curlybraces", title: "Share as JSON",
            subtitle: "Structured transcript data"
        ) {
            Task {
                if let url = await session.export(threadId: current.threadId, format: "json") {
                    shareFile = ShareFile(url: url)
                }
            }
        })
        if current.busy, case let .bot(bot) = current {
            out.append(PlusAction(
                id: "stop", systemImage: "stop.fill", title: "Interrupt",
                subtitle: "Stop the current turn", destructive: true
            ) { Task { await session.interrupt(bot: bot) } })
        }
        return out
    }

    private func startsANewStretch(at index: Int, in rows: [TranscriptRow]) -> Bool {
        guard index > 0 else { return true }
        return rows[index].at - rows[index - 1].endAt > 30 * 60 * 1000
    }

    private func endsRun(at index: Int, in rows: [TranscriptRow]) -> Bool {
        guard index + 1 < rows.count else { return true }
        let this = rows[index], next = rows[index + 1]
        if this.role != next.role { return true }
        if this.senderName != next.senderName { return true }
        return next.kind != .text
    }

    private var canSend: Bool {
        (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty)
            && !preparingAttachments && !sendingMessage
    }

    private var composerDraft: Binding<String> {
        Binding(
            get: { draft },
            set: { proposed in
                if acceptsNextHardwareLineBreak {
                    acceptsNextHardwareLineBreak = false
                    draft = proposed
                } else if ComposerKeyboard.shouldSubmit(
                    previousText: draft,
                    proposedText: proposed
                ) {
                    submit()
                } else {
                    draft = proposed
                }
            }
        )
    }

    private var hasPendingApproval: Bool {
        messages.contains { $0.card?.isPending == true }
    }

    private var queuedSends: [QueuedSend] {
        session.state.pendingQueued[current.threadId] ?? []
    }

    private var engineCanSteer: Bool {
        guard case let .bot(bot) = current else { return false }
        return session.steeringInstanceIds.contains(bot.modelSelection.instanceId)
    }

    private var injectNow: (() -> Void)? {
        guard case let .bot(bot) = current else { return nil }
        return {
            Haptics.impact(.medium)
            dictation.stop()
            steering = true
            Task {
                await session.interrupt(bot: bot)
                try? await Task.sleep(for: .seconds(20))
                steering = false
            }
        }
    }

    private var willQueue: Bool {
        current.busy && !engineCanSteer
    }

    private var composerPrompt: String {
        if sendingMessage { return "Sending…" }
        if dictation.isListening { return "Listening…" }
        guard current.busy else { return "Ask \(current.name)" }
        if engineCanSteer { return "Sends into this turn" }
        return "Sends after this turn"
    }

    private func submit(_ explicitText: String? = nil) {
        // This also cancels an in-flight permission prompt before it can
        // open the microphone after the message has already been sent.
        dictation.stop()
        let draftAtSend = draft
        let text = (explicitText ?? draftAtSend).trimmingCharacters(in: .whitespacesAndNewlines)
        let outgoingAttachments = attachments
        let chatAtSend = current
        guard !text.isEmpty || !outgoingAttachments.isEmpty,
              !preparingAttachments,
              !sendingMessage
        else { return }
        sendingMessage = true
        attachmentError = nil
        showCommandHUD = false
        showingPlus = false
        Task {
            let sent = await session.send(
                text: text,
                attachments: outgoingAttachments,
                to: chatAtSend
            )
            sendingMessage = false
            guard sent else {
                let failure = session.actionError ?? AppLanguage.message("Couldn't send this message. Try again.")
                if threadId == chatAtSend.threadId { attachmentError = failure }
                else { threadDrafts[chatAtSend.threadId]?.error = failure }
                session.actionError = nil
                return
            }
            if threadId != chatAtSend.threadId {
                if threadDrafts[chatAtSend.threadId]?.text == draftAtSend { threadDrafts[chatAtSend.threadId]?.text = "" }
                if threadDrafts[chatAtSend.threadId]?.attachments.map(\.id) == outgoingAttachments.map(\.id) {
                    threadDrafts[chatAtSend.threadId]?.attachments = []
                }
                return
            }
            if draft == draftAtSend {
                draft = ""
            }
            if attachments.map(\.id) == outgoingAttachments.map(\.id) {
                attachments = []
            }
            SoundEffects.playSent()
            Haptics.impact(.medium)
        }
    }

    private func importPhotos(_ items: [PhotosPickerItem]) async {
        guard !preparingAttachments, !sendingMessage else { return }
        let importingThread = threadId
        let existingAttachments = attachments
        let available = AttachmentPolicy.maximumItems - existingAttachments.count
        guard items.count <= available else {
            selectedPhotos = []
            attachmentError = "Send up to \(AttachmentPolicy.maximumItems) items at a time."
            return
        }

        preparingAttachments = true
        attachmentError = nil
        defer {
            preparingAttachments = false
            selectedPhotos = []
        }

        do {
            var imported: [PendingMessageAttachment] = []
            for (index, item) in items.enumerated() {
                guard let raw = try await item.loadTransferable(type: Data.self) else {
                    throw AttachmentImportError.unreadable("that photo")
                }
                let actualType = CGImageSourceCreateWithData(raw as CFData, nil)
                    .flatMap(CGImageSourceGetType)
                    .flatMap { UTType($0 as String) }
                let actualMime = actualType?.preferredMIMEType
                    .map(AttachmentPolicy.normalizedMIME)

                let data: Data
                let mime: String
                let fileExtension: String
                if let actualMime, AttachmentPolicy.imageMIMETypes.contains(actualMime) {
                    data = raw
                    mime = actualMime
                    fileExtension = actualType?.preferredFilenameExtension ?? "jpg"
                } else if let image = UIImage(data: raw),
                          let jpeg = image.jpegData(compressionQuality: 0.9) {
                    data = jpeg
                    mime = "image/jpeg"
                    fileExtension = "jpg"
                } else {
                    throw AttachmentImportError.unsupported("that photo")
                }

                let candidate = PendingMessageAttachment(
                    id: UUID(),
                    data: data,
                    name: items.count == 1 ? "Photo.\(fileExtension)" : "Photo \(index + 1).\(fileExtension)",
                    mime: mime,
                    kind: .image
                )
                try AttachmentPolicy.validate(existingAttachments + imported + [candidate])
                imported.append(candidate)
            }
            if threadId == importingThread { attachments.append(contentsOf: imported) }
            else { threadDrafts[importingThread, default: ComposerSnapshot()].attachments.append(contentsOf: imported) }
            Haptics.selection()
        } catch {
            if threadId == importingThread { attachmentError = error.localizedDescription }
            else { threadDrafts[importingThread]?.error = error.localizedDescription }
        }
    }

    private func importFiles(_ result: Result<[URL], Error>) {
        guard case let .success(urls) = result else {
            if case let .failure(error) = result { attachmentError = error.localizedDescription }
            return
        }
        guard !urls.isEmpty else { return }
        Task { await importFiles(urls) }
    }

    private func importFiles(_ urls: [URL]) async {
        guard !preparingAttachments, !sendingMessage else { return }
        let importingThread = threadId
        let existingAttachments = attachments
        let available = AttachmentPolicy.maximumItems - existingAttachments.count
        guard urls.count <= available else {
            attachmentError = "Send up to \(AttachmentPolicy.maximumItems) items at a time."
            return
        }

        preparingAttachments = true
        attachmentError = nil
        defer { preparingAttachments = false }

        do {
            var imported: [PendingMessageAttachment] = []
            for url in urls {
                let usedBytes = (existingAttachments + imported).reduce(0) { $0 + $1.data.count }
                let remainingBytes = max(0, AttachmentPolicy.maximumTotalBytes - usedBytes)
                let candidate = try await Task.detached(priority: .userInitiated) {
                    try Self.readImportedFile(url, remainingBytes: remainingBytes)
                }.value
                try AttachmentPolicy.validate(existingAttachments + imported + [candidate])
                imported.append(candidate)
            }
            if threadId == importingThread { attachments.append(contentsOf: imported) }
            else { threadDrafts[importingThread, default: ComposerSnapshot()].attachments.append(contentsOf: imported) }
            Haptics.selection()
        } catch {
            if threadId == importingThread { attachmentError = error.localizedDescription }
            else { threadDrafts[importingThread]?.error = error.localizedDescription }
        }
    }

    nonisolated private static func readImportedFile(
        _ url: URL,
        remainingBytes: Int
    ) throws -> PendingMessageAttachment {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }

        let values = try url.resourceValues(
            forKeys: [.contentTypeKey, .isRegularFileKey, .fileSizeKey]
        )
        guard values.isRegularFile != false else {
            throw AttachmentImportError.unreadable(url.lastPathComponent)
        }
        let name = url.lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw AttachmentImportError.unreadable("that file") }
        let inferred = values.contentType ?? UTType(filenameExtension: url.pathExtension)
        let mime = AttachmentPolicy.normalizedMIME(
            inferred?.preferredMIMEType ?? "application/octet-stream"
        )
        guard let kind = AttachmentPolicy.kind(forMIME: mime) else {
            throw AttachmentImportError.unsupported(name)
        }
        let itemLimit = kind == .image
            ? AttachmentPolicy.maximumImageBytes
            : AttachmentPolicy.maximumFileBytes
        let readLimit = min(itemLimit, remainingBytes)
        if let fileSize = values.fileSize, fileSize > readLimit {
            throw AttachmentImportError.tooLarge(name, readLimit)
        }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let data = try handle.read(upToCount: readLimit + 1) ?? Data()
        guard data.count <= readLimit else {
            throw AttachmentImportError.tooLarge(name, readLimit)
        }
        return PendingMessageAttachment(
            id: UUID(), data: data, name: name, mime: mime, kind: kind
        )
    }

    private func openThread(_ ref: ThreadRef) {
        cancelThreadOpen()
        let shownBotId: String? = current.isBot ? current.id : nil
        threadOpenTask = Task {
            let openedThreadId = await session.openThread(ref, shownBotId: shownBotId)
            guard !Task.isCancelled else { return }
            threadOpenTask = nil
            if let openedThreadId { selectedThreadId = openedThreadId }
        }
    }

    private func cancelThreadOpen() {
        threadOpenTask?.cancel()
        threadOpenTask = nil
    }

    private func openLink(_ url: URL, from message: Message) -> OpenURLAction.Result {
        guard let target = LocalMessageLink.resolve(url) else {
            fileOpenError = AppLanguage.message("This link can't be opened securely.")
            return .handled
        }
        switch target {
        case let .web(webURL):
            return .systemAction(webURL)
        case let .desktopFile(path):
            openFile(path: path, from: message)
            return .handled
        }
    }

    private func openFile(path: String, from message: Message) {
        fileDownloadTask?.cancel()
        let requestID = UUID()
        fileDownloadRequestID = requestID
        let requestedThreadID = threadId
        fileOpenError = nil
        let name = URL(fileURLWithPath: path).lastPathComponent
        openingFileName = name.isEmpty ? "file" : name
        let task = Task {
            let downloaded = await session.downloadFile(
                threadId: requestedThreadID,
                messageId: message.id,
                path: path
            )
            if let downloaded, let preview = FilePreviewItem(downloaded: downloaded) {
                guard !Task.isCancelled, fileDownloadRequestID == requestID else {
                    preview.cleanUp()
                    return
                }
                openingFileName = nil
                filePreview?.cleanUp()
                filePreview = preview
                fileDownloadRequestID = nil
                fileDownloadTask = nil
                return
            }
            guard !Task.isCancelled, fileDownloadRequestID == requestID else { return }
            openingFileName = nil
            fileDownloadRequestID = nil
            fileDownloadTask = nil
            guard downloaded != nil else {
                fileOpenError = session.actionError ?? AppLanguage.message("Couldn't open that file. Try again.")
                session.actionError = nil
                return
            }
            fileOpenError = "The downloaded file couldn't be previewed."
        }
        fileDownloadTask = task
    }

    private func resetFilePreview() {
        fileDownloadTask?.cancel()
        fileDownloadTask = nil
        fileDownloadRequestID = nil
        openingFileName = nil
        fileOpenError = nil
        filePreview?.cleanUp()
        filePreview = nil
    }

    private var composer: some View {
        VStack(spacing: 6) {
            if preparingAttachments || sendingMessage {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text(preparingAttachments ? "Preparing attachments…" : "Sending…")
                        .font(.system(size: 13, weight: .medium))
                }
                .foregroundStyle(Color.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 4)
                .accessibilityElement(children: .combine)
            }

            if let openingFileName {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Opening \(openingFileName)…")
                        .font(.system(size: 13, weight: .medium))
                        .lineLimit(1)
                }
                .foregroundStyle(Color.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 4)
                .accessibilityElement(children: .combine)
            }

            if let error = fileOpenError ?? attachmentError {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(Color.orange)
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.primary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 4)
                    Button("Dismiss") {
                        fileOpenError = nil
                        attachmentError = nil
                    }
                    .font(.system(size: 13, weight: .semibold))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                .accessibilityElement(children: .combine)
            }

            if let error = dictation.error {
                Text(error)
                    .font(.system(size: 13))
                    .foregroundStyle(.orange)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
            }

            if showCommandHUD {
                CommandSkillHUDView(
                    text: $draft,
                    isVisible: $showCommandHUD,
                    commands: current.isBot
                        ? CommandSkillHUDView.defaultCommands
                        : CommandSkillHUDView.defaultCommands.filter {
                            $0.id != "computer" && (current.supportsTasks || $0.id != "tasks")
                        },
                    accentColor: MausPalette.color(current.color)
                ) { command in
                    switch command.id {
                    case "computer":
                        draft = ""
                        showingComputer = true
                    case "tasks":
                        draft = ""
                        showingTasks = true
                    default: submit(command.command)
                    }
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            } else if draft.isEmpty && attachments.isEmpty && !current.busy
                        && !hasPendingApproval && !storedChips.isEmpty {
                PredictiveActionChipsView(chips: storedChips, accentColor: MausPalette.color(current.color)) { chip in
                    submit(chip.prompt)
                }
                .transition(.opacity)
            }

            if !attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(attachments) { attachment in
                            PendingAttachmentChip(attachment: attachment) {
                                guard !preparingAttachments, !sendingMessage else { return }
                                attachments.removeAll { $0.id == attachment.id }
                                attachmentError = nil
                            }
                        }
                    }
                    .padding(.horizontal, 2)
                }
                .scrollClipDisabled()
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            ForEach(queuedSends) { send in
                QueuedSendRow(
                    send: send,
                    onSteer: injectNow,
                    isSteering: steering,
                    onCancel: { Task { await session.cancelQueued(send, in: current) } }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            GlassGroup(spacing: 10) {
                HStack(alignment: .bottom, spacing: 10) {
                    Button {
                        dictation.stop()
                        composerFocused = false
                        withAnimation(.snappy(duration: 0.28)) { showingPlus.toggle() }
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 20, weight: .medium))
                            .foregroundStyle(showingPlus ? Color(uiColor: .systemBackground) : Color.primary)
                            .rotationEffect(.degrees(showingPlus ? 45 : 0))
                            .frame(width: 44, height: 44)
                            .background(Circle().fill(showingPlus ? Color.primary : Color.clear))
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .glassCapsule()
                    .disabled(preparingAttachments || sendingMessage)
                    .accessibilityLabel(showingPlus ? "Close" : "More")

                    HStack(alignment: .bottom, spacing: 6) {
                        Button {
                            dictation.stop()
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                                showCommandHUD.toggle()
                            }
                            Haptics.selection()
                        } label: {
                            Image(systemName: "command")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(showCommandHUD ? Color.primary : Color.secondary)
                                .frame(width: 30, height: 32)
                        }
                        .buttonStyle(.plain)
                        .disabled(preparingAttachments || sendingMessage)
                        .accessibilityLabel("Slash commands")
                        .padding(.leading, 6)
                        .padding(.bottom, 6)

                        TextField(
                            composerPrompt,
                            text: composerDraft,
                            axis: .vertical
                        )
                            .lineLimit(1...5)
                            .font(.system(size: 17))
                            .padding(.vertical, 11)
                            .focused($composerFocused)
                            .accessibilityIdentifier("message-input")
                            .submitLabel(.send)
                            .allowsHitTesting(
                                !dictation.isListening && !dictation.isStarting
                                    && !preparingAttachments && !sendingMessage
                            )
                            .onChange(of: draft) { _, value in
                                withAnimation(.easeInOut(duration: 0.15)) {
                                    showCommandHUD = value.hasPrefix("/")
                                }
                            }
                            .onKeyPress(.return, phases: .down) { press in
                                if press.modifiers.contains(.shift) {
                                    acceptsNextHardwareLineBreak = true
                                    return .ignored
                                }
                                acceptsNextHardwareLineBreak = false
                                submit()
                                return .handled
                            }
                            .onSubmit { submit() }

                        Button {
                            composerFocused = false
                            dictation.toggle(capturing: draft)
                        } label: {
                            Image(systemName: dictation.isListening ? "mic.fill" : "mic")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(dictation.isListening ? Color.red : Color.primary)
                                .frame(width: 32, height: 32)
                                .background(
                                    Circle().fill(
                                        dictation.isListening
                                            ? Color.red.opacity(0.2)
                                            : Color.secondary.opacity(0.12)
                                    )
                                )
                                .symbolEffect(.pulse, isActive: dictation.isListening)
                        }
                        .buttonStyle(.plain)
                        .disabled(preparingAttachments || sendingMessage)
                        .padding(.bottom, 6)
                        .accessibilityLabel(dictation.isListening ? "Stop dictation" : "Start dictation")

                        Button { submit() } label: {
                            Image(systemName: "arrow.up")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(canSend ? Color.white : Color.secondary)
                                .frame(width: 32, height: 32)
                                .background(
                                    Circle().fill(canSend ? BubbleColor.mine : Color.secondary.opacity(0.18))
                                )
                        }
                        .buttonStyle(.plain)
                        .disabled(!canSend)
                        .padding(.trailing, 6)
                        .padding(.bottom, 6)
                        .animation(.easeOut(duration: 0.15), value: canSend)
                        .accessibilityLabel(
                            willQueue
                                ? "Queue this message for when the turn finishes"
                                : current.busy ? "Send into the running turn" : "Send message"
                        )
                    }
                    .frame(minHeight: 44)
                    .glassCapsule(interactive: false)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
        .padding(.bottom, 8)
        .frame(maxWidth: CompanionLayout.chatWidth)
        .frame(maxWidth: .infinity)
    }
}

struct MessageRow: View {
    let chat: Chat
    let message: Message
    var endsRun = true
    let openLink: (URL, Message) -> OpenURLAction.Result
    var openThread: ((ThreadRef) -> Void)? = nil
    @EnvironmentObject private var session: Session
    @State private var editingText = ""
    @State private var showingEdit = false
    @State private var selecting: SelectableText?

    private static let reactionChoices = ["👍", "❤️", "😂", "🎉", "👀"]

    private var versions: [Message] {
        session.state.versions(of: message, inThread: chat.threadId)
    }

    private var attachedContent: AttachedMessageContent {
        AttachedMessageContent.parse(message.text ?? "")
    }

    var body: some View {
        VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 6) {
            content

            if let comm = message.comm {
                Label(message.tool?.name ?? "Messaged \(comm.withName)", systemImage: "arrow.up.right.bubble")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.secondary)
            }

            if let reactions = message.reactions, !reactions.isEmpty {
                HStack(spacing: 6) {
                    ForEach(reactionGroups(reactions), id: \.emoji) { group in
                        Button("\(group.emoji) \(group.count)") {
                            Haptics.selection()
                            Task { await session.react(to: message, in: chat.threadId, emoji: group.emoji) }
                        }
                        .font(.system(size: 13))
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.capsule)
                        .tint(group.mine ? Color.accentColor : Color.secondary)
                    }
                }
            }

            if versions.count > 1, let index = versions.firstIndex(where: { $0.id == message.id }),
               case let .bot(bot) = chat {
                HStack(spacing: 8) {
                    Button {
                        Task { await session.switchVersion(to: versions[index - 1], for: bot) }
                    } label: { Image(systemName: "chevron.left") }
                    .disabled(index == 0 || bot.busy == true)
                    Text("\(index + 1) of \(versions.count)")
                    Button {
                        Task { await session.switchVersion(to: versions[index + 1], for: bot) }
                    } label: { Image(systemName: "chevron.right") }
                    .disabled(index + 1 >= versions.count || bot.busy == true)
                }
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.secondary)
            }
        }
        .contextMenu {
            ForEach(Self.reactionChoices, id: \.self) { emoji in
                Button(emoji) {
                    Haptics.selection()
                    Task { await session.react(to: message, in: chat.threadId, emoji: emoji) }
                }
            }
            let visibleText = attachedContent.text
            if !visibleText.isEmpty {
                Divider()
                Button("Copy", systemImage: "doc.on.doc") {
                    PlatformBridge.copyToPasteboard(visibleText)
                }
            }
            if !visibleText.isEmpty {
                Button("Select Text", systemImage: "selection.pin.in.out") {
                    selecting = SelectableText(text: visibleText)
                }
            }
            if message.role == .user,
               message.kind == .text,
               attachedContent.attachments.isEmpty,
               case let .bot(bot) = chat {
                Divider()
                Button("Edit and retry", systemImage: "pencil") {
                    editingText = message.text ?? ""
                    showingEdit = true
                }
                .disabled(bot.busy == true)
            }
        }
        .alert("Edit and retry", isPresented: $showingEdit) {
            TextField("Message", text: $editingText)
            Button("Cancel", role: .cancel) {}
            if case let .bot(bot) = chat {
                Button("Send") {
                    let text = editingText.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !text.isEmpty else { return }
                    Task { await session.edit(message, for: bot, text: text) }
                }
            }
        } message: {
            Text("This creates a new version and continues from there.")
        }
        .sheet(item: $selecting) { SelectableTextSheet(text: $0.text) }
    }

    @ViewBuilder
    private var content: some View {
        switch message.kind {
        case .text:
            TextBubble(message: message, chat: chat, tailed: endsRun, openLink: openLink)
        case .options:
            CardView(chat: chat, message: message)
        case .secret:
            if let secret = message.secret {
                CredentialRequestCardView(chat: chat, message: message, secret: secret)
            } else if let text = message.text, !text.isEmpty {
                TextBubble(message: message, chat: chat, tailed: endsRun, openLink: openLink)
            }
        case .activity:
            ActivityChip(tool: message.tool, threadRef: message.threadRef, openThread: openThread)
        case .screen:
            ScreenShot(threadId: chat.threadId, message: message)
        case .unknown:
            if let text = message.text, !text.isEmpty {
                TextBubble(message: message, chat: chat, tailed: endsRun, openLink: openLink)
            }
        }
    }

    private func reactionGroups(_ reactions: [Reaction]) -> [(emoji: String, count: Int, mine: Bool)] {
        Dictionary(grouping: reactions, by: \.emoji)
            .map { (emoji: $0.key, count: $0.value.count, mine: $0.value.contains { $0.by == "user" }) }
            .sorted { $0.emoji < $1.emoji }
    }
}

private struct ShareFile: Identifiable {
    let url: URL
    var id: String { url.path }
}

struct SelectableText: Identifiable {
    let id = UUID()
    let text: String
}

private struct ActivityShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

struct TextBubble: View {
    let message: Message
    let chat: Chat
    var tailed = true
    let openLink: (URL, Message) -> OpenURLAction.Result

    private var attachedContent: AttachedMessageContent {
        AttachedMessageContent.parse(message.text ?? "")
    }

    private var parsedDiff: (filename: String, diff: String)? {
        guard message.role != .user, let source = message.text else { return nil }
        let text = source.trimmingCharacters(in: .whitespacesAndNewlines)
        let diff: String
        if text.hasPrefix("```diff"), text.hasSuffix("```") {
            diff = String(text.dropFirst("```diff".count).dropLast(3))
                .trimmingCharacters(in: .whitespacesAndNewlines)
        } else if text.hasPrefix("diff --git ") {
            diff = text
        } else {
            return nil
        }
        let firstLine = diff.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? ""
        let filename = firstLine.split(separator: " ").last.map(String.init)?
            .replacingOccurrences(of: "b/", with: "") ?? "Git patch"
        return (filename, diff)
    }

    private var parsedTable: (headers: [String], rows: [[String]])? {
        guard message.role != .user, let source = message.text else { return nil }
        let lines = source.components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        guard lines.count >= 3, lines.allSatisfy({ $0.hasPrefix("|") && $0.hasSuffix("|") }) else {
            return nil
        }
        let headers = Self.tableCells(lines[0])
        let separators = Self.tableCells(lines[1])
        guard !headers.isEmpty, separators.count == headers.count,
              separators.allSatisfy(Self.isTableSeparator) else { return nil }
        let rows = lines.dropFirst(2).map(Self.tableCells)
        guard rows.allSatisfy({ $0.count == headers.count }) else { return nil }
        return (headers, rows)
    }

    private static func tableCells(_ line: String) -> [String] {
        var body = line
        if body.first == "|" { body.removeFirst() }
        if body.last == "|" { body.removeLast() }

        var cells: [String] = []
        var cell = ""
        var escaped = false
        for character in body {
            if escaped {
                if character == "|" {
                    cell.append(character)
                } else {
                    cell.append("\\")
                    cell.append(character)
                }
                escaped = false
            } else if character == "\\" {
                escaped = true
            } else if character == "|" {
                cells.append(cell.trimmingCharacters(in: .whitespaces))
                cell = ""
            } else {
                cell.append(character)
            }
        }
        if escaped { cell.append("\\") }
        cells.append(cell.trimmingCharacters(in: .whitespaces))
        return cells
    }

    private static func isTableSeparator(_ cell: String) -> Bool {
        let compact = cell.replacingOccurrences(of: " ", with: "")
        let core = compact.trimmingCharacters(in: CharacterSet(charactersIn: ":"))
        return core.count >= 3 && core.allSatisfy { $0 == "-" }
    }

    var body: some View {
        let mine = message.role == .user
        let customCard = parsedDiff != nil || parsedTable != nil
        let speaker = message.from
        HStack(alignment: .bottom, spacing: 0) {
            if mine { Spacer(minLength: 56) }

            VStack(alignment: .leading, spacing: 4) {
                if let speaker, !mine {
                    Text(speaker.name)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(MausPalette.color(speaker.color))
                }
                if let diff = parsedDiff {
                    GitPRDiffCardView(filename: diff.filename, diffText: diff.diff)
                } else if let table = parsedTable {
                    SQLResultTableView(columns: table.headers, rows: table.rows)
                } else if mine {
                    let shared = attachedContent
                    ForEach(Array(shared.attachments.enumerated()), id: \.offset) { _, attachment in
                        TranscriptAttachmentView(
                            attachment: attachment,
                            threadId: chat.threadId,
                            messageId: message.id
                        )
                    }
                    if !shared.text.isEmpty {
                        Text(shared.text)
                            .font(.system(size: 17))
                            .foregroundStyle(BubbleColor.mineText)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } else {
                    MarkdownText(source: message.text ?? "") { url in
                        openLink(url, message)
                    }
                        .foregroundStyle(Color.primary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if mine, message.steered == true {
                    Text("sent mid-turn")
                        .font(.system(size: 11))
                        .foregroundStyle(BubbleColor.mineText.opacity(0.72))
                }
            }
            .padding(.horizontal, customCard ? 0 : 15)
            .padding(.vertical, customCard ? 0 : 11)
            .background(
                Group {
                    if !customCard {
                        SpeechBubble(tail: tailed ? (mine ? .trailing : .leading) : .none)
                            .fill(mine ? BubbleColor.mine : BubbleColor.theirs)
                    }
                }
            )
            .padding(.bottom, !customCard && tailed ? SpeechBubble.tailDrop() : 0)

            if !mine { Spacer(minLength: 44) }
        }
    }
}

struct ActivityChip: View {
    let tool: ToolActivity?
    var threadRef: ThreadRef? = nil
    var openThread: ((ThreadRef) -> Void)? = nil

    var body: some View {
        if let tool {
            let receipt = SkillExecutionReceiptView(
                skillName: tool.name,
                status: tool.ok.map { $0 ? "success" : "error" } ?? "running"
            )
            .padding(.leading, 2)

            if let threadRef, let openThread {
                Button {
                    Haptics.selection()
                    openThread(threadRef)
                } label: {
                    receipt.allowsHitTesting(false)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tool.name)
                .accessibilityHint("Opens the thread")
            } else {
                receipt
            }
        }
    }
}

/// A credential entered here is encrypted for the exact computer whose
/// public key was pinned by the pairing QR. Password AutoFill remains
/// provider-neutral: Apple Passwords works without another subscription,
/// while 1Password, Bitwarden and other enabled providers work as usual.
struct CredentialRequestCardView: View {
    let chat: Chat
    let message: Message
    let secret: SecretRequestCardData
    @EnvironmentObject private var session: Session
    @Environment(\.scenePhase) private var scenePhase
    @State private var value = ""
    @State private var fieldID = UUID()
    @State private var preparedSubmission: PreparedPhoneCredential?
    @State private var submissionTask: Task<Void, Never>?
    @State private var activeSubmissionID: UUID?
    @State private var submitting = false
    @State private var submitted = false
    @State private var submissionError: String?

    private struct RequestIdentity: Equatable {
        let connectionID: String?
        let botID: String?
        let threadID: String
        let messageID: String
        let target: String?
        let requestKey: String?
    }

    private var tint: Color { MausPalette.color(message.from?.color ?? chat.color) }
    private var requester: String { message.from?.name ?? chat.name }
    private var label: String { visible(secret.label) ?? "API credential" }
    private var accessibilityStatus: Text {
        if secret.provided == true {
            return secret.resumed == true
            ? Text("Saved securely. The task resumed.")
            : Text("Saved securely on your computer.")
        }
        if secret.dismissed == true { return Text("Not provided.") }
        if submitted { return Text("Encrypted and sent to your computer.") }
        if canEnterOnPhone { return Text("Enter it securely on this phone.") }
        if !hasSecurePairing { return Text("Pair again by QR code, or finish on your computer.") }
        return Text("Use secure phone access or Tailscale, or finish on your computer.")
    }

    private func visible(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private var helpURL: URL? {
        guard let raw = secret.helpUrl,
              let url = URL(string: raw),
              url.scheme?.lowercased() == "https",
              url.host != nil,
              url.user == nil,
              url.password == nil
        else { return nil }
        return url
    }

    private var hasSecurePairing: Bool {
        guard secret.isPending,
              visible(secret.target) != nil,
              visible(secret.requestKey) != nil,
              let connection = session.connection
        else { return false }
        return connection.secretPublicKey != nil && connection.companionDeviceId != nil
    }

    private var hasProtectedTransport: Bool {
        session.phoneCredentialTransportIsProtected
    }

    private var canEnterOnPhone: Bool { hasSecurePairing && hasProtectedTransport }

    private var placeholder: String { visible(secret.placeholder) ?? label }

    private var canSubmit: Bool {
        guard canEnterOnPhone, !submitting, !submitted else { return false }
        return preparedSubmission != nil
            || !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var requestIdentity: RequestIdentity {
        let botID: String?
        switch chat {
        case let .bot(bot): botID = bot.id
        case .room: botID = message.from?.botId
        }
        return RequestIdentity(
            connectionID: session.connection?.id,
            botID: botID,
            threadID: chat.threadId,
            messageID: message.id,
            target: secret.target,
            requestKey: secret.requestKey
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 11) {
                Image(systemName: "key.fill")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 38, height: 38)
                    .background(tint.opacity(0.13), in: RoundedRectangle(cornerRadius: 11, style: .continuous))

                VStack(alignment: .leading, spacing: 3) {
                    Text(label)
                        .font(.system(size: 16, weight: .semibold))
                    Text("Requested by \(requester)")
                        .font(.system(size: 12.5))
                        .foregroundStyle(Color.secondary)
                }
                Spacer(minLength: 0)
            }

            if let description = visible(secret.description) {
                Text(description)
                    .font(.system(size: 14.5))
                    .foregroundStyle(Color.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if secret.provided == true {
                VStack(alignment: .leading, spacing: 8) {
                    Label(
                        secret.resumed == true ? "Saved securely. The task resumed." : "Saved securely on your computer.",
                        systemImage: "checkmark.shield.fill"
                    )
                    .foregroundStyle(.green)

                    if secret.resumed != true, let preparedSubmission {
                        Button(action: { send(preparedSubmission) }) {
                            HStack(spacing: 7) {
                                if submitting { ProgressView() }
                                Image(systemName: "arrow.clockwise")
                                Text(submitting ? "Resuming…" : "Try resuming the task")
                            }
                            .font(.system(size: 13, weight: .semibold))
                        }
                        .disabled(submitting || !hasProtectedTransport)
                    }
                }
            } else if secret.dismissed == true {
                Label("Not provided", systemImage: "xmark.circle")
                    .foregroundStyle(Color.secondary)
            } else if submitted {
                Label("Encrypted and saved on your computer", systemImage: "checkmark.shield.fill")
                    .foregroundStyle(.green)
            } else if canEnterOnPhone {
                VStack(alignment: .leading, spacing: 5) {
                    Label("Enter securely on this phone", systemImage: "lock.shield.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(tint)

                    if preparedSubmission == nil {
                        SecureField(placeholder, text: $value)
                            .id(fieldID)
                            .textContentType(.password)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .privacySensitive()
                            .disabled(submitting)
                            .submitLabel(.done)
                            .onSubmit { submit() }
                            .padding(.horizontal, 12)
                            .frame(minHeight: 44)
                            .background(
                                Color.secondary.opacity(0.1),
                                in: RoundedRectangle(cornerRadius: 11, style: .continuous)
                            )
                            .accessibilityLabel(label)
                    } else {
                        Label(
                            submitting ? "Encrypted and saving…" : "Encrypted and ready to retry",
                            systemImage: "lock.fill"
                        )
                        .font(.system(size: 13))
                        .foregroundStyle(Color.secondary)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .padding(.horizontal, 12)
                        .background(
                            Color.secondary.opacity(0.1),
                            in: RoundedRectangle(cornerRadius: 11, style: .continuous)
                        )
                    }

                    Button(action: submit) {
                        HStack(spacing: 7) {
                            if submitting { ProgressView().tint(.white) }
                            Image(systemName: "lock.fill")
                            Text(
                                submitting
                                    ? "Saving securely…"
                                    : preparedSubmission == nil ? "Save securely" : "Try again securely"
                            )
                        }
                        .font(.system(size: 14, weight: .semibold))
                        .frame(maxWidth: .infinity, minHeight: 42)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(tint)
                    .disabled(!canSubmit)

                    if preparedSubmission != nil, !submitting, submissionError != nil {
                        Button("Enter a different value") {
                            discardPreparedSubmission()
                        }
                        .font(.system(size: 13, weight: .medium))
                    }

                    Text("Use Apple Passwords, 1Password, Bitwarden, or paste. The value is encrypted for your computer and never added to chat.")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(11)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            } else if !hasSecurePairing {
                VStack(alignment: .leading, spacing: 5) {
                    Label("Pair again to enter here", systemImage: "qrcode")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(tint)
                    Text("This pairing predates secure phone entry. Scan a fresh QR from StartupBot, or finish this request on your computer.")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(11)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            } else {
                VStack(alignment: .leading, spacing: 5) {
                    Label("Secure connection required", systemImage: "lock.shield.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(tint)
                    Text("Switch to Secure phone access (HTTPS) or Tailscale, then try again. You can still finish this request on your computer.")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(11)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            }

            if let submissionError = visible(submissionError) {
                Label(submissionError, systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 12.5))
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let error = visible(secret.error) {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 12.5))
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let helpURL {
                Link(destination: helpURL) {
                    Label("Where to get this key", systemImage: "arrow.up.right")
                        .font(.system(size: 13, weight: .medium))
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color.secondary.opacity(0.09))
        )
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(secret.isPending ? tint.opacity(0.65) : Color.clear, lineWidth: 1.25)
        }
        .accessibilityElement(children: canEnterOnPhone ? .contain : .combine)
        .accessibilityLabel("\(label). \(accessibilityStatus)")
        .onAppear {
            preparedSubmission = session.preparedCredential(
                chat: chat,
                message: message,
                secret: secret
            )
        }
        .onChange(of: requestIdentity) { _, _ in
            resetSensitiveState(clearPrepared: true)
            preparedSubmission = session.preparedCredential(
                chat: chat,
                message: message,
                secret: secret
            )
            submitted = false
        }
        .onChange(of: session.credentialEntryResetGeneration) { _, _ in
            suspendSensitiveEntry()
        }
        .onChange(of: session.status) { _, status in
            if status != .live { suspendSensitiveEntry() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { suspendSensitiveEntry() }
        }
        .onDisappear {
            clearPlaintext()
            submissionError = nil
        }
    }

    private func submit() {
        guard canSubmit else { return }
        submissionError = nil
        if let preparedSubmission {
            send(preparedSubmission)
            return
        }

        do {
            // Encryption happens synchronously. No task closure ever captures
            // the cleartext, and the native field is replaced immediately.
            let prepared = try session.prepareCredential(
                value,
                chat: chat,
                message: message,
                secret: secret
            )
            clearPlaintext()
            preparedSubmission = prepared
            send(prepared)
        } catch {
            clearPlaintext()
            submissionError = error.localizedDescription
            Haptics.notification(.error)
        }
    }

    private func send(_ prepared: PreparedPhoneCredential) {
        submissionTask?.cancel()
        let submissionID = UUID()
        activeSubmissionID = submissionID
        submissionError = nil
        submitting = true

        submissionTask = Task { @MainActor in
            do {
                try await session.provideCredential(prepared)
                guard !Task.isCancelled, activeSubmissionID == submissionID else { return }
                submitted = true
                Haptics.success()
            } catch {
                guard !Task.isCancelled, activeSubmissionID == submissionID else { return }
                // Retry retains ciphertext only; cleartext credential input must already be discarded.
                submissionError = error.localizedDescription
                Haptics.notification(.error)
            }

            guard activeSubmissionID == submissionID else { return }
            activeSubmissionID = nil
            submissionTask = nil
            submitting = false
        }
    }

    private func clearPlaintext() {
        value.removeAll(keepingCapacity: false)
        fieldID = UUID()
    }

    private func suspendSensitiveEntry() {
        clearPlaintext()
        activeSubmissionID = nil
        submissionTask?.cancel()
        submissionTask = nil
        submitting = false
        submissionError = nil
        // Keep an already-encrypted envelope. If the request reached the
        // computer before iOS suspended it, foreground Retry must send the
        // exact same operation instead of generating fresh HPKE randomness.
    }

    private func resetSensitiveState(clearPrepared: Bool) {
        suspendSensitiveEntry()
        if clearPrepared, let preparedSubmission {
            session.discardPreparedCredential(preparedSubmission)
            self.preparedSubmission = nil
        }
    }

    private func discardPreparedSubmission() {
        resetSensitiveState(clearPrepared: true)
        submitted = false
    }

}

struct CardView: View {
    let chat: Chat
    let message: Message
    @EnvironmentObject private var session: Session
    @State private var answering = false

    private var allowChoice: String? {
        guard let options = message.card?.options else { return nil }
        return options.first { $0.caseInsensitiveCompare("Allow") == .orderedSame }
            ?? options.first { !Self.isRefusal($0) }
    }

    private static func isRefusal(_ option: String) -> Bool { OptionCard.isRefusal(option) }

    private var tint: Color { MausPalette.color(chat.color) }

    var body: some View {
        if let card = message.card {
            VStack(alignment: .leading, spacing: 10) {
                if card.isPending {
                    Label("\(chat.name) is waiting on you", systemImage: "hand.raised.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(tint)
                }
                Text(card.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.primary)
                    .fixedSize(horizontal: false, vertical: true)
                if !card.subtitle.isEmpty {
                    Text(card.subtitle)
                        .font(.system(size: 15))
                        .foregroundStyle(Color.secondary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let skill = card.skillRequest {
                    if let preview = skill.preview, let sha256 = skill.reviewedSha256 {
                        VStack(alignment: .leading, spacing: 7) {
                            HStack {
                                Text("Review the complete SKILL.md")
                                    .font(.system(size: 12, weight: .semibold))
                                Spacer()
                                Text("sha256 \(String(sha256.prefix(8)))")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(Color.secondary)
                            }
                            Text(skill.source.map { LocalizedStringKey("Source: \($0)") } ?? "Source: unknown")
                                .font(.system(size: 11))
                                .foregroundStyle(Color.secondary)
                                .textSelection(.enabled)
                            ScrollView(.vertical) {
                                Text(preview)
                                    .font(.system(size: 12, design: .monospaced))
                                    .foregroundStyle(Color.primary)
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .frame(maxHeight: 220)
                            .padding(10)
                            .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                            ForEach(skill.references ?? [], id: \.path) { file in
                                Text(file.path)
                                    .font(.system(size: 11, design: .monospaced))
                                    .textSelection(.enabled)
                                ScrollView(.vertical) {
                                    Text(file.content)
                                        .font(.system(size: 12, design: .monospaced))
                                        .textSelection(.enabled)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .frame(maxHeight: 220)
                                .padding(10)
                                .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                            }
                        }
                    } else {
                        Label(
                            "This proposal was created by an older build and cannot be safely applied. Deny it and ask the bot to create it again.",
                            systemImage: "exclamationmark.shield"
                        )
                        .font(.system(size: 12))
                        .foregroundStyle(.orange)
                    }
                }

                if let held = card.held {
                    Label(held, systemImage: "exclamationmark.shield")
                        .font(.system(size: 13))
                        .foregroundStyle(.orange)
                }

                if card.isPending {
                    if let request = card.questionRequest {
                        StructuredQuestionCardView(chat: chat, card: card, request: request)
                    } else {
                    HStack(spacing: 8) {
                        ForEach(card.options, id: \.self) { option in
                            Button {
                                Haptics.selection()
                                answering = true
                                Task {
                                    await session.answer(chat: chat, card: card, choice: option)
                                    answering = false
                                }
                            } label: {
                                Text(option)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Self.isRefusal(option) ? Color.primary : .white)
                                    .frame(maxWidth: .infinity)
                                    .frame(height: 40)
                                    .background(
                                        Capsule().fill(Self.isRefusal(option) ? Color.secondary.opacity(0.18) : tint)
                                    )
                            }
                            .buttonStyle(.plain)
                            .disabled(
                                answering ||
                                    (card.skillRequest != nil && !Self.isRefusal(option) &&
                                        card.skillRequest?.reviewedSha256 == nil)
                            )
                        }
                    }
                    .padding(.top, 2)

                    // The grant key comes from the card. The phone never
                    // derives its own, so it cannot permit something subtly
                    // wider than the computer would have. The same goes for
                    // the answer: it is one of the options the card offered,
                    // never a string invented here.
                    if card.isPermission, card.allowKey != nil, let allow = allowChoice, case .bot = chat {
                        Button("Always allow this tool") {
                            Haptics.selection()
                            answering = true
                            Task {
                                await session.answer(
                                    chat: chat,
                                    card: card,
                                    choice: allow,
                                    rememberingPermission: true
                                )
                                answering = false
                            }
                        }
                        .font(.system(size: 12))
                        .foregroundStyle(Color.secondary)
                        .frame(maxWidth: .infinity)
                        .disabled(answering)
                    }
                    }
                } else if let answered = card.answered {
                    Label(QuestionAnswerForm.display(card.answeredText ?? answered), systemImage: "checkmark.circle")
                        .font(.system(size: 14))
                        .foregroundStyle(Color.secondary)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(card.isPending ? tint.opacity(0.12) : Color.secondary.opacity(0.13))
            )
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(card.isPending ? tint : .clear, lineWidth: 1.5)
            }
        }
    }
}

struct ScreenShot: View {
    let threadId: String
    let message: Message
    @EnvironmentObject private var session: Session
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            } else {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.secondary.opacity(0.13))
                    .frame(height: 160)
                    .overlay { ProgressView() }
            }
        }
        .task {
            guard image == nil else { return }
            let data: Data?
            if let inline = message.png, let decoded = Data(base64Encoded: inline) {
                data = decoded
            } else if message.hasImage == true {
                data = await session.image(threadId: threadId, messageId: message.id)
            } else {
                data = nil
            }
            image = data.flatMap(UIImage.init(data:))
        }
    }
}

struct StreamingBubble: View {
    let text: String?
    let reasoning: String?
    var color: String = "blue"

    var body: some View {
        HStack(alignment: .bottom, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                if let reasoning, !reasoning.isEmpty, text?.isEmpty != false {
                    AgentThoughtChamberView(
                        reasoning: String(reasoning.suffix(2_000)),
                        botName: "Bot",
                        mascotColor: MausPalette.color(color),
                        isStreaming: true
                    )
                }
                if let text, !text.isEmpty {
                    MarkdownText(source: text, caret: true)
                        .foregroundStyle(Color.primary)
                }
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 11)
            .background(SpeechBubble(tail: .leading).fill(BubbleColor.theirs))
            .padding(.bottom, SpeechBubble.tailDrop())
            Spacer(minLength: 44)
        }
    }
}
