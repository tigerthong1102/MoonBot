// Modified for StartupBot; original copyright and license retained.
/// A small, platform-neutral decision seam for the companion's first-run flow.
///
/// Keeping this outside SwiftUI makes the important transitions explicit and
/// testable: skipping setup must not look like a pairing, a pending deep link
/// must still open pairing, and a revoked credential must never fall through
/// to an ordinary empty state.
public enum CompanionPairingState: Equatable, Sendable {
    case unpaired
    case paired
    case revoked
}

public enum CompanionOnboardingRoute: Equatable, Sendable {
    case welcome
    case pairing
    case unpairedHome
    case notificationPrompt
    case chats
    case revoked
}

/// The permission lookup is asynchronous at launch. Treating that short
/// unresolved window as a final answer can skip first-pair education forever.
public enum CompanionNotificationAuthorizationState: Equatable, Sendable {
    case unresolved
    case notDetermined
    case determined
}

/// Durable preference names shared by the app's pairing commit and its root
/// router. The pending marker is intentionally separate from the benign
/// "already saw this" preference: a new pairing may finish before iOS returns
/// the current notification authorization status.
public enum CompanionOnboardingPreferences {
    public static let pendingNotificationOnboardingKey =
        "companion.onboarding.notificationPending"
}

public enum CompanionPairingCommitSequence {
    public static func persist(
        markNotificationOnboardingPending: () -> Void,
        saveConnection: () -> Void
    ) {
        markNotificationOnboardingPending()
        saveConnection()
    }
}

public enum CompanionPairingInviteEvent: Equatable, Sendable {
    case received(PairingInvite)
    case consumed
    case pairingSucceeded
    case signedOut
}

/// Pure invite lifecycle shared by Session and sequence tests. A paired phone
/// may receive another computer's invite; PairingView keeps the current
/// connection alive until the new credential is safely committed.
public enum CompanionPairingInvitePolicy {
    public static func nextInvite(
        current: PairingInvite?,
        after event: CompanionPairingInviteEvent
    ) -> PairingInvite? {
        switch event {
        case .received(let invite):
            return invite
        case .consumed, .pairingSucceeded, .signedOut:
            return nil
        }
    }
}

public enum CompanionNotificationOnboardingPolicy {
    public static func shouldKeepPending(
        isPending: Bool,
        hasCompletedStep: Bool,
        authorization: CompanionNotificationAuthorizationState
    ) -> Bool {
        guard isPending else { return false }
        guard authorization != .unresolved else { return true }
        return authorization == .notDetermined && !hasCompletedStep
    }
}

public struct CompanionPairingSubmissionState: Equatable, Sendable {
    public private(set) var isInFlight = false

    public init() {}

    public var allowsNavigation: Bool { !isInFlight }

    @discardableResult
    public mutating func begin() -> Bool {
        guard !isInFlight else { return false }
        isInFlight = true
        return true
    }

    public mutating func finish() {
        isInFlight = false
    }
}

public struct CompanionOnboardingContext: Equatable, Sendable {
    public var pairingState: CompanionPairingState
    public var hasSeenWelcome: Bool
    public var pairingRequested: Bool
    public var hasPendingPairingInvite: Bool
    public var notificationOnboardingPending: Bool
    public var hasSeenNotificationPrompt: Bool
    public var notificationAuthorization: CompanionNotificationAuthorizationState

    public init(
        pairingState: CompanionPairingState,
        hasSeenWelcome: Bool,
        pairingRequested: Bool = false,
        hasPendingPairingInvite: Bool = false,
        notificationOnboardingPending: Bool = false,
        hasSeenNotificationPrompt: Bool = false,
        notificationAuthorization: CompanionNotificationAuthorizationState = .notDetermined
    ) {
        self.pairingState = pairingState
        self.hasSeenWelcome = hasSeenWelcome
        self.pairingRequested = pairingRequested
        self.hasPendingPairingInvite = hasPendingPairingInvite
        self.notificationOnboardingPending = notificationOnboardingPending
        self.hasSeenNotificationPrompt = hasSeenNotificationPrompt
        self.notificationAuthorization = notificationAuthorization
    }
}

public enum CompanionOnboardingRouter {
    public static func route(for context: CompanionOnboardingContext) -> CompanionOnboardingRoute {
        switch context.pairingState {
        case .revoked:
            return .revoked
        case .paired:
            if context.pairingRequested || context.hasPendingPairingInvite {
                return .pairing
            }
            if context.notificationOnboardingPending,
               !context.hasSeenNotificationPrompt,
               context.notificationAuthorization == .notDetermined {
                return .notificationPrompt
            }
            return .chats
        case .unpaired:
            if context.pairingRequested || context.hasPendingPairingInvite {
                return .pairing
            }
            return context.hasSeenWelcome ? .unpairedHome : .welcome
        }
    }
}
