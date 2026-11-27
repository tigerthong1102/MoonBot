// Modified for StartupBot; original copyright and license retained.
import SwiftUI
import CompanionCore
import UserNotifications

@main
struct CompanionApp: App {
    @StateObject private var session = Session()
    @Environment(\.scenePhase) private var scenePhase
    @State private var liveActivities = LiveActivityCoordinator()
    @AppStorage(PrefKey.language) private var language = AppLanguage.system.rawValue

    #if DEBUG && targetEnvironment(simulator)
    init() {
        if ProcessInfo.processInfo.arguments.contains("--startupbot-test-fresh-welcome") {
            UserDefaults.standard.removeObject(forKey: CompanionOnboardingPreferences.welcomeSeenKey)
        }
    }
    #endif

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .environment(\.locale, AppLanguage.resolved(language).locale ?? .autoupdatingCurrent)
                .id(language)
                .onAppear {
                    #if DEBUG && targetEnvironment(simulator)
                    StartupBotInternalProbe.runIfRequested()
                    #endif
                    OpenMausSharedInbox.removeDirectories(olderThan: 60 * 60)
                    session.connect()
                    liveActivities.attach(to: session)
                }
                .onOpenURL { session.receivePairingURL($0) }
                .onChange(of: scenePhase) { _, phase in
                    switch phase {
                    case .active:
                        OpenMausSharedInbox.removeDirectories(olderThan: 60 * 60)
                        session.connect()
                        Task { await session.refreshNotificationAuthorization() }
                    case .background: session.linger()
                    case .inactive: break
                    @unknown default: break
                    }
                }
        }
        .defaultSize(CompanionLayout.defaultWindowSize)
    }
}

struct RootView: View {
    @EnvironmentObject private var session: Session
    @AppStorage(CompanionOnboardingPreferences.welcomeSeenKey) private var hasSeenWelcome = false
    @AppStorage("companion.onboarding.notificationsSeen") private var hasSeenNotificationPrompt = false
    @AppStorage(CompanionOnboardingPreferences.pendingNotificationOnboardingKey)
    private var notificationOnboardingPending = false
    var body: some View {
        Group {
            switch route {
            case .welcome:
                CompanionWelcomeView(
                    onConnect: startPairing,
                    onSkip: {
                        hasSeenWelcome = true
                        session.endPairing()
                    }
                )
            case .pairing:
                PairingView {
                    hasSeenWelcome = true
                    session.endPairing()
                }
                .onAppear {
                    hasSeenWelcome = true
                    session.beginPairing()
                }
            case .unpairedHome:
                UnpairedHomeView(onConnect: startPairing)
            case .notificationPrompt:
                NotificationOnboardingView {
                    hasSeenNotificationPrompt = true
                    notificationOnboardingPending = false
                    session.endPairing()
                }
                .onAppear { hasSeenWelcome = true }
            case .chats:
                ChatListView()
                    .onAppear {
                        hasSeenWelcome = true
                        session.endPairing()
                        reconcileNotificationOnboarding()
                    }
            case .revoked:
                UnpairedView(
                    onPairAgain: {
                        session.signOut()
                        startPairing()
                    },
                    onChooseAnother: session.connections.first(where: {
                        $0.id != session.connection?.id
                    }).map { computer in
                        { session.switchComputer(to: computer.id) }
                    }
                )
            }
        }
        .background(Color(uiColor: .systemBackground).ignoresSafeArea())
        .onChange(of: session.pairingInvite) { _, invite in
            guard invite != nil else { return }
            hasSeenWelcome = true
            session.beginPairing()
        }
        .onAppear { reconcileNotificationOnboarding() }
        .onChange(of: session.notificationAuthorizationResolved) { _, _ in
            reconcileNotificationOnboarding()
        }
        .onChange(of: session.notificationAuthorization) { _, _ in
            reconcileNotificationOnboarding()
        }
        .onChange(of: notificationOnboardingPending) { _, isPending in
            if isPending { reconcileNotificationOnboarding() }
        }
        .alert("Open on another computer?", isPresented: Binding(
            get: { session.notificationComputer != nil },
            set: { if !$0 { session.notificationComputer = nil } }
        ), presenting: session.notificationComputer) { target in
            if let id = target.connectionID, let computer = session.connections.first(where: { $0.id == id }) {
                Button(computer.name) { Task { await session.confirmNotificationComputer(target) } }
            }
            Button("Cancel", role: .cancel) { }
        }
        .alert(
            "Something went wrong",
            isPresented: Binding(
                get: { session.actionError != nil },
                set: { if !$0 { session.actionError = nil } }
            ),
            presenting: session.actionError
        ) { _ in
            Button("OK", role: .cancel) { session.actionError = nil }
        } message: { message in
            Text(message)
        }
    }

    private var route: CompanionOnboardingRoute {
        let pairingState: CompanionPairingState
        if session.status == .unauthorized {
            pairingState = .revoked
        } else if session.connection != nil {
            pairingState = .paired
        } else {
            pairingState = .unpaired
        }
        return CompanionOnboardingRouter.route(for: .init(
            pairingState: pairingState,
            hasSeenWelcome: hasSeenWelcome,
            pairingRequested: session.pairingRequested,
            hasPendingPairingInvite: session.pairingInvite != nil,
            notificationOnboardingPending: notificationOnboardingPending,
            hasSeenNotificationPrompt: hasSeenNotificationPrompt,
            notificationAuthorization: notificationAuthorizationState
        ))
    }

    private var notificationAuthorizationState: CompanionNotificationAuthorizationState {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-store-preview") { return .determined }
        #endif
        guard session.notificationAuthorizationResolved else { return .unresolved }
        return session.notificationAuthorization == .notDetermined ? .notDetermined : .determined
    }

    private func reconcileNotificationOnboarding() {
        notificationOnboardingPending = CompanionNotificationOnboardingPolicy.shouldKeepPending(
            isPending: notificationOnboardingPending,
            hasCompletedStep: hasSeenNotificationPrompt,
            authorization: notificationAuthorizationState
        )
    }

    private func startPairing() {
        hasSeenWelcome = true
        session.beginPairing()
    }
}

/// The token stopped working. Almost always because someone revoked this
/// phone on the computer — which is exactly what that button is for, so the
/// honest thing is to say so and offer to pair again.
struct UnpairedView: View {
    let onPairAgain: () -> Void
    let onChooseAnother: (() -> Void)?

    var body: some View {
        NavigationStack {
            ContentUnavailableView {
                Label("This device was unpaired", systemImage: "lock.slash")
            } description: {
                Text("The connection was removed on your computer. Pair again to keep using your chats here.")
            } actions: {
                Button("Pair again", action: onPairAgain)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                if let onChooseAnother {
                    Button("Use another computer", action: onChooseAnother)
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                }
            }
        }
    }
}
