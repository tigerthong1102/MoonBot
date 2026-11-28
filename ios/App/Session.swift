// Modified for StartupBot; original copyright and license retained.
import Foundation
import OSLog
import SwiftUI
import CompanionCore
import UserNotifications
import UIKit

private let log = Logger(subsystem: "ai.startupbot.companion", category: "stream")

private final class CachedAttachmentDownload: NSObject {
    let value: DownloadedFile

    init(_ value: DownloadedFile) {
        self.value = value
    }
}

/// An immutable, ciphertext-only credential write prepared on the main
/// actor before any asynchronous work begins. HPKE uses fresh randomness for
/// every seal, so retries must reuse this exact value rather than encrypting
/// the same credential again after an ambiguous network failure.
struct PreparedPhoneCredential: Equatable, Sendable {
    fileprivate let requestIdentity: String
    fileprivate let connectionID: String
    fileprivate let botID: String
    fileprivate let messageID: String
    fileprivate let envelope: PhoneSecretEnvelope
}

@MainActor
final class Session: ObservableObject {
    enum Status: Equatable {
        case unpaired
        case connecting
        case live
        /// The token stopped working — revoked on the computer, most likely.
        case unauthorized
        case offline(String)
    }

    @Published private(set) var state = CompanionState()
    @Published private(set) var connection: Connection?
    @Published private(set) var connections: [Connection] = []
    var canAdminister: Bool { connection?.canAdminister ?? false }
    @Published private(set) var status: Status = .unpaired
    @Published var actionError: String?
    @Published private(set) var focusedMessageId: String?
    @Published private(set) var notificationAuthorization: UNAuthorizationStatus = .notDetermined
    @Published private(set) var notificationAuthorizationResolved = false
    @Published private(set) var steeringInstanceIds: Set<String> = []
    @Published private(set) var pairingInvite: PairingInvite?
    /// Pairing can be opened while another computer remains connected. The
    /// working session is only replaced after the new credential commits.
    @Published private(set) var pairingRequested = false
    // Sensitive input must be cleared when the originating runtime disconnects.
    @Published private(set) var credentialEntryResetGeneration = 0

    @Published var notificationComputer: NotificationTarget?
    @Published private(set) var notificationChat: Chat?

    private var client: CompanionClient?
    /// Ciphertext-only operations survive navigation and transient
    /// disconnects so a retry cannot accidentally reseal the same value with
    /// a different HPKE operation id. Nothing here is persisted to disk.
    private var preparedPhoneCredentials: [String: PreparedPhoneCredential] = [:]
    /// The device token, kept in memory so the client can be rebuilt when the
    /// dial moves to another stored host. The keychain remains the only place
    /// it is persisted.
    private var token: String?
    private var rotation = CandidateRotation(hosts: [])
    private var streamTask: Task<Void, Never>?

    private var endpointRefreshTask: Task<Void, Never>?
    private var streamGeneration = 0
    private var runtimeGeneration = 0
    private var reconnectDelay: UInt64 = 0
    private var screenWatchers = 0
    /// Authenticated avatar bytes shared by roster, header, group and task
    /// surfaces. Both entry count and byte cost are bounded because one valid
    /// uploaded image may be 10 MB.
    private let avatarCache: NSCache<NSString, NSData> = {
        let cache = NSCache<NSString, NSData>()
        cache.countLimit = 64
        cache.totalCostLimit = 32 * 1_024 * 1_024
        return cache
    }()
    private var avatarFetches: [String: (id: UUID, task: Task<Data?, Never>)] = [:]
    private var avatarCacheGeneration = 0
    private let attachmentCache: NSCache<NSString, CachedAttachmentDownload> = {
        let cache = NSCache<NSString, CachedAttachmentDownload>()
        cache.countLimit = 12
        cache.totalCostLimit = 32 * 1_024 * 1_024
        return cache
    }()
    private var attachmentCacheGeneration = 0
    private var attachmentSendIDs: [AttachmentDraftKey: String] = [:]
    /// A saved connection exists, but its token could not be read yet. Keeps
    /// "the keychain is locked" from being mistaken for "not paired".
    private var restorePending = false
    /// A notification can cold-launch the app before protected Keychain data
    /// is available. Retain the last explicitly tapped destination until the
    /// paired client can be rebuilt after unlock.
    private var pendingNotification: NotificationTarget?

    /// The exact route the current client will use for a credential write.
    var phoneCredentialTransportIsProtected: Bool {
        client?.connection.activeEndpoint?.protectsCredentials == true
    }

    private struct AttachmentDraftKey: Hashable {
        let destination: MessageDestination
        let text: String
        let attachmentIDs: [UUID]
    }

    private var registry = CompanionConnectionRegistry()

#if DEBUG && targetEnvironment(simulator)
    init(fixtureClient: CompanionClient, fleet: Fleet? = nil) {
        client = fixtureClient
        connection = fixtureClient.connection
        status = .live
        if let fleet { state.hydrate(fleet) }
    }

    func replaceFixtureClient(_ replacement: CompanionClient) {
        stopActiveRuntime()
        client = replacement
        connection = replacement.connection
        status = .live
    }
#endif

    init() {
        Self.removeStaleFilePreviews()
        _ = NotificationCoordinator.shared
        NotificationCoordinator.shared.responseHandler = { [weak self] target in
            Task { @MainActor in await self?.openNotification(target) }
        }
#if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        let previewResource = arguments.contains("-structured-question-preview") ? "QuestionPreview"
            : arguments.contains("-threads-preview") ? "ThreadPreview" : "StorePreview"
        if (arguments.contains("-store-preview") || arguments.contains("-computer-switcher-preview")),
           let url = Bundle.main.url(
               forResource: previewResource,
               withExtension: "json"
           ),
           let data = try? Data(contentsOf: url),
           let fleet = try? JSONDecoder().decode(Fleet.self, from: data) {
            let preview = Connection(
                id: "preview-current",
                name: "MacBook Pro",
                host: "preview.tailnet.ts.net",
                port: 8810
            )
            connection = preview
            if arguments.contains("-computer-switcher-preview") {
                let other = Connection(
                    id: "preview-other",
                    name: "MacBook Air",
                    host: "air.tailnet.ts.net",
                    port: 8810
                )
                registry = CompanionConnectionRegistry(
                    connections: [preview, other],
                    activeConnectionID: preview.id
                )
                connections = registry.connections
            } else {
                connections = [preview]
            }
            state.hydrate(fleet)
            status = .live
            return
        }
#endif
        restore()
        Task { await refreshNotificationAuthorization() }
    }

    /// A locked or unavailable Keychain is temporary and must not delete saved pairing metadata.
    private func restore() {
        restorePending = false
        registry = OpenMausSharedConnectionStore.loadRegistry()
        connections = registry.connections
        for saved in registry.connections where saved.id != registry.activeConnectionID {
            _ = try? Keychain.token(for: saved.id)
        }
        restoreSelectedConnection()
    }

    /// Find the first selected pairing whose Keychain token still exists.
    /// A missing token is a genuinely unusable saved record; a locked
    /// Keychain is temporary and must leave the record untouched.
    private func restoreSelectedConnection() {
        guard let saved = registry.activeConnection else {
            clearActiveConnection()
            return
        }

        let stored: String?
        do {
            stored = try Keychain.token(for: saved.id)
        } catch {
            connection = saved
            restorePending = true
            status = .offline(
                (error as? KeychainError)?.isLocked == true
                    ? AppLanguage.message("Unlock this device to reach your computer.")
                    : error.localizedDescription
            )
            return
        }
        guard let stored else {
            registry.remove(id: saved.id)
            persistRegistry()
            connections = registry.connections
            restoreSelectedConnection()
            return
        }

        configureActiveConnection(saved, token: stored)
    }

    /// Redeem a one-time pairing credential. On success the device token goes
    /// to the keychain and the connection to defaults — deliberately apart,
    /// so the thing that gets backed up is never the credential.
    func pair(
        with connection: Connection,
        credential: String,
        deviceName: String,
        pairRequestId: String
    ) async throws {
        var invited = connection
        // QR invites already carry this policy. Manual entry reaches the
        // session as a parsed Connection, so establish the same consent
        // boundary here before any health probe or credential redemption.
        if invited.allowedRouteKinds == nil {
            invited.establishRoutePolicyFromInvite()
        }
        // A 12-character code pairs with a server directly (its own sessions,
        // a bearer with the code's scopes); anything else is the companion's.
        if let code = PairingInvite.normalizedServerCode(credential) {
            try await Self.confirmServer(at: invited)
            let paired = try await CompanionClient.pairWithServer(
                connection: invited,
                code: code,
                label: deviceName,
                attemptId: pairRequestId
            )
            var stored = invited
            if !paired.environment.label.isEmpty { stored.name = paired.environment.label }
            stored.serverEnvironmentId = paired.environment.environmentId
            stored.serverScopes = paired.session.scopes
            stored.companionDeviceId = nil
            if let existing = registry.matchingConnection(for: stored) {
                stored.id = existing.id
            }
            try commitPairing(stored, token: paired.token)
            return
        }
        let outcome = try await CompanionClient.pairFirstReachable(
            connection: invited,
            credential: credential,
            deviceName: deviceName,
            pairRequestId: pairRequestId
        )
        let paired = outcome.response
        var stored = outcome.connection
        if !paired.serverName.isEmpty { stored.name = paired.serverName }
        stored.companionDeviceId = paired.device.id
        // Redeeming a pairing invitation cannot widen its explicit route consent.
        stored.applyPairingAdvertisement(hosts: paired.hosts, endpoints: paired.endpoints)
        let winner = outcome.connection.activeEndpoint ?? CompanionEndpoint.direct(
            host: outcome.connection.host,
            port: outcome.connection.port,
            priority: 10_000
        )
        if let winner { stored.promote(winner) }
        if stored.endpoints?.isEmpty != false {
            stored.hosts = Array(stored.orderedHosts.prefix(8))
        }
        if let existing = registry.matchingConnection(for: stored) {
            stored.id = existing.id
        }
        try commitPairing(stored, token: paired.token, winner: winner)
    }

    func signInToMobile(_ connection: Connection, email: String, code: String) async throws {
        let result = try await CompanionClient(connection: connection, token: nil).mobileLogin(email: email, code: code)
        try Task.checkCancellation()
        guard let origin = connection.activeEndpoint?.url,
              result.environment.environmentId == "startupbot-mobile:" + origin,
              result.token.hasPrefix("sb_mobile_") else { throw APIError.badURL }
        var stored = connection
        stored.establishRoutePolicyFromInvite()
        stored.name = result.environment.label
        stored.serverEnvironmentId = result.environment.environmentId
        stored.serverScopes = ["chat"]
        if let existing = registry.matchingConnection(for: stored) { stored.id = existing.id }
        try commitPairing(stored, token: result.token)
    }

    /// Device tokens must remain in Keychain, separate from backed-up connection metadata.
    private func commitPairing(_ stored: Connection, token: String, winner: CompanionEndpoint? = nil) throws {
        try Keychain.save(token, for: stored.id)
        let firstPairing = registry.connections.isEmpty
        var updatedRegistry = registry
        updatedRegistry.upsert(stored)
        CompanionPairingCommitSequence.persist {
            if firstPairing {
                UserDefaults.standard.set(
                    true,
                    forKey: CompanionOnboardingPreferences.pendingNotificationOnboardingKey
                )
            }
        } saveConnection: {
            OpenMausSharedConnectionStore.saveRegistry(updatedRegistry)
        }

        stopActiveRuntime()
        pairingInvite = CompanionPairingInvitePolicy.nextInvite(
            current: pairingInvite,
            after: .pairingSucceeded
        )
        pairingRequested = false
        registry = updatedRegistry
        connections = registry.connections
        self.connection = stored
        self.token = token
        let liveRoutes = winner.map { route in
            [route] + stored.orderedEndpoints.filter { $0.url != route.url }
        } ?? stored.orderedEndpoints
        self.rotation = CandidateRotation(endpoints: liveRoutes)
        self.client = CompanionClient(
            connection: winner.map(stored.dialing) ?? stored,
            token: token
        )
        self.state = CompanionState()
        // A fresh pairing settles any restore that was still waiting on the
        // keychain — the token is in hand, so there is nothing left to retry.
        restorePending = false
        connect()
    }

    private static func confirmServer(at connection: Connection) async throws {
        let probe = CompanionClient(connection: connection, token: nil, requestTimeout: 8)
        do {
            _ = try await probe.environment()
        } catch APIError.status(404, _) {
            throw APIError.transport(
                "\(connection.displayAddress) isn't an StartupBot server. Check the address and try again."
            )
        }
    }

    func receivePairingURL(_ url: URL) {
        guard let invite = PairingInvite.parse(url) else {
            actionError = AppLanguage.message("That pairing invitation is not valid. Start pairing again on your computer.")
            return
        }
        pairingInvite = CompanionPairingInvitePolicy.nextInvite(
            current: pairingInvite,
            after: .received(invite)
        )
        pairingRequested = true
    }

    func beginPairing() {
        pairingRequested = true
    }

    func endPairing() {
        pairingRequested = false
        consumePairingInvite()
    }

    func consumePairingInvite() {
        pairingInvite = CompanionPairingInvitePolicy.nextInvite(
            current: pairingInvite,
            after: .consumed
        )
    }

    func switchComputer(to id: String) {
        guard let saved = registry.connection(id: id) else { return }
        if connection?.id == id {
            restartStream()
            connect()
            return
        }

        let stored: String?
        do {
            stored = try Keychain.token(for: id)
        } catch {
            actionError = (error as? KeychainError)?.isLocked == true
                ? AppLanguage.message("Unlock this device, then try switching computers again.")
                : error.localizedDescription
            return
        }
        guard let stored else {
            actionError = AppLanguage.message("This saved connection is no longer available on this device. Remove it and pair again.")
            return
        }

        stopActiveRuntime()
        registry.select(id: id)
        persistRegistry()
        connections = registry.connections
        configureActiveConnection(saved, token: stored)
        connect()
    }

    func forgetConnection(id: String) {
        guard let forgotten = registry.connection(id: id) else { return }
        let wasActive = registry.activeConnectionID == id
        // A server session is ended on the server too, best effort: the
        // bearer is discarded locally either way.
        if forgotten.pairedWithServer, let token = try? Keychain.token(for: id) {
            let client = CompanionClient(connection: forgotten, token: token)
            Task.detached { try? await client.logout() }
        }
        if wasActive { stopActiveRuntime() }
        preparedPhoneCredentials = preparedPhoneCredentials.filter { $0.value.connectionID != id }
        Keychain.remove(id)
        registry.remove(id: id)
        persistRegistry()
        connections = registry.connections
        guard wasActive else { return }

        connection = nil
        client = nil
        token = nil
        rotation = CandidateRotation(hosts: [])
        state = CompanionState()
        resetAvatarCache()
        NotificationCoordinator.shared.setBadge(0)
        restoreSelectedConnection()
        if connection != nil { connect() }
        if connections.isEmpty {
            UserDefaults.standard.removeObject(
                forKey: CompanionOnboardingPreferences.pendingNotificationOnboardingKey
            )
        }
    }

    /// Compatibility for the existing revoked-pairing and detail actions:
    /// sign out now means remove only the selected computer.
    func signOut() {
        guard let id = connection?.id ?? registry.activeConnectionID else {
            clearActiveConnection()
            return
        }
        forgetConnection(id: id)
    }

    private func clearActiveConnection() {
        resetCredentialEntry()
        streamTask?.cancel()
        streamTask = nil
        endpointRefreshTask?.cancel()
        endpointRefreshTask = nil
        restorePending = false
        pendingNotification = nil
        pairingInvite = CompanionPairingInvitePolicy.nextInvite(
            current: pairingInvite,
            after: .signedOut
        )
        pairingRequested = false
        connection = nil
        client = nil
        token = nil
        rotation = CandidateRotation(hosts: [])
        state = CompanionState()
        resetAvatarCache()
        resetAttachmentCache()
        attachmentSendIDs.removeAll()
        NotificationCoordinator.shared.setBadge(0)
        status = .unpaired
    }

    private func configureActiveConnection(_ saved: Connection, token stored: String) {
        connection = saved
        token = stored
        // New connections honor the desktop's transport policy. Automatic
        // walking is credential-safe: protected routes stay protected, while
        // a legacy/local route is only tried when it was the exact saved route.
        rotation = CandidateRotation(endpoints: saved.orderedEndpoints)
        let first = rotation.currentEndpoint.map(saved.dialing) ?? saved
        client = CompanionClient(connection: first, token: stored)
        status = .connecting
    }

    private func stopActiveRuntime() {
        runtimeGeneration += 1
        resetCredentialEntry()
        streamGeneration += 1
        streamTask?.cancel()
        streamTask = nil
        endpointRefreshTask?.cancel()
        endpointRefreshTask = nil
        restorePending = false
        endLinger()
        pendingNotification = nil
        screenWatchers = 0
        client = nil
        token = nil
        state = CompanionState()
        resetAvatarCache()
        resetAttachmentCache()
        attachmentSendIDs.removeAll()
        NotificationCoordinator.shared.setBadge(0)
    }

    private func persistRegistry() {
        OpenMausSharedConnectionStore.saveRegistry(registry)
    }

    private func persistActiveConnection(_ updated: Connection) {
        registry.upsert(updated, makeActive: false)
        connection = updated
        connections = registry.connections
        persistRegistry()
    }

    func connect() {
        // A restore that found the keychain locked left `client` nil on
        // purpose. Coming to the front is the moment worth retrying on: the
        // app is on screen, so the phone is in someone's hand and unlocked.
        if client == nil, restorePending { restore() }
        if client != nil, let pendingNotification {
            self.pendingNotification = nil
            Task { [weak self] in await self?.openNotification(pendingNotification) }
        }
        endLinger()
        guard client != nil, streamTask == nil else { return }
        reconnectDelay = 0
        streamGeneration += 1
        let generation = streamGeneration
        streamTask = Task { [weak self] in
            guard let self else { return }
            await self.run()
            guard self.streamGeneration == generation else { return }
            self.streamTask = nil
        }
    }

    func refresh() async {
        restartStream()
        connect()
        let deadline = Date().addingTimeInterval(10)
        while status == .connecting, !Task.isCancelled, Date() < deadline {
            try? await Task.sleep(nanoseconds: 120_000_000)
        }
    }

    func watchScreen(of botId: String) {
        screenWatchers += 1
        if screenWatchers == 1 { restartStream() }
    }

    func stopWatchingScreen(of botId: String) {
        screenWatchers = max(0, screenWatchers - 1)
        if screenWatchers == 0 {
            state.clearScreen(botId)
            restartStream()
        }
    }

    private func restartStream() {
        guard streamTask != nil else { return }
        streamTask?.cancel()
        streamTask = nil
        connect()
    }

    func disconnect() {
        resetCredentialEntry()
        streamTask?.cancel()
        streamTask = nil
        endpointRefreshTask?.cancel()
        endpointRefreshTask = nil
        endLinger()
    }

    private func resetCredentialEntry() {
        credentialEntryResetGeneration &+= 1
    }

    private var lingerTask: UIBackgroundTaskIdentifier = .invalid
    private var lingerSleep: Task<Void, Never>?

    func linger() {
        guard streamTask != nil, lingerTask == .invalid else { disconnect(); return }
        lingerSleep?.cancel()
        lingerSleep = nil
        let task = UIApplication.shared.beginBackgroundTask(withName: "companion.linger") { [weak self] in
            self?.disconnect()
        }
        guard task != .invalid else { disconnect(); return }
        lingerTask = task
        lingerSleep = Task { [weak self] in
            try? await Task.sleep(for: .seconds(25))
            guard !Task.isCancelled, let self, self.lingerTask != .invalid else { return }
            self.disconnect()
        }
    }

    private func endLinger() {
        lingerSleep?.cancel()
        lingerSleep = nil
        guard lingerTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(lingerTask)
        lingerTask = .invalid
    }

    private func run() async {
        while !Task.isCancelled {
            guard let client else { return }
            status = .connecting
            // A replacement server must not receive a saved bearer credential.
            if let expected = client.connection.serverEnvironmentId {
                let live = try? await client.environment()
                if Task.isCancelled { return }
                if let live, live.environmentId != expected {
                    log.error("server identity changed: \(expected, privacy: .public) is now \(live.environmentId, privacy: .public)")
                    status = .unauthorized
                    return
                }
            }
            log.info("opening stream, cursor=\(self.state.cursor ?? "none", privacy: .public)")
            do {
                for try await frame in try client.events(since: state.cursor, screens: screenWatchers > 0) {
                    if Task.isCancelled { return }
                    reconnectDelay = 0

                    if case let .hello(cursor, resumed) = frame.frame {
                        log.info("stream live, resumed=\(resumed, privacy: .public)")
                        if !resumed {
                            try await hydrate(using: client)
                            state.resetCursor(cursor)
                        }
                        status = .live
                        // Remember what actually carried the stream for
                        // display and legacy ordering. Typed routes retain
                        // their explicit security priority next launch.
                        rememberWorkingRoute()
                        refreshConnectionMetadata(using: client)
                        continue
                    }
                    state.apply(frame)
                    if case let .notify(notification) = frame.frame {
                        NotificationCoordinator.shared.deliver(notification, sequence: frame.seq, connectionID: client.connection.id, computerName: client.connection.name)
                    }
                    NotificationCoordinator.shared.setBadge(state.unreadCount)
                    state.advance(to: frame.seq)
                }
                log.notice("stream ended without an error")
                status = .offline(AppLanguage.message("Lost the connection."))
            } catch let error as APIError where error.isUnauthorized {
                log.error("stream refused: unauthorized")
                status = .unauthorized
                return
            } catch {
                if Task.isCancelled || error is CancellationError {
                    log.info("stream closed by us")
                    return
                }
                log.error("stream failed: \(error.localizedDescription, privacy: .public)")
                status = .offline(failureMessage(for: error))
            }

            if Task.isCancelled { return }
            reconnectDelay = reconnectDelay == 0 ? 1 : min(reconnectDelay * 2, 15)
            try? await Task.sleep(nanoseconds: reconnectDelay * 1_000_000_000)
        }
    }

    private func hydrate(using client: CompanionClient) async throws {
        let generation = streamGeneration
        for _ in 0..<2 {
            let expectedCursor = state.cursor
            let snapshot = try await client.fleetForHydration(messages: 50)
            try Task.checkCancellation()
            guard streamGeneration == generation, self.client?.connection.id == client.connection.id else {
                throw CancellationError()
            }
            guard state.hydrate(snapshot.fleet, waitingThreads: snapshot.waitingThreads,
                                ifCursorMatches: expectedCursor) else { continue }
            log.info("hydrated \(snapshot.fleet.bots.count, privacy: .public) bots, \(snapshot.fleet.groups.count, privacy: .public) rooms")
            NotificationCoordinator.shared.setBadge(state.unreadCount)
            let runtime = runtimeGeneration
            Task { [weak self] in
                let engines = (try? await client.instances()) ?? []
                guard let self, self.isCurrent(client, generation: runtime) else { return }
                self.steeringInstanceIds = Set(
                    engines.filter { $0.capabilities?.queueing == true }.map(\.instanceId)
                )
            }
            return
        }
        throw APIError.status(code: 409, message: AppLanguage.message("Conversations changed while loading. Please try opening this notification again."))
    }

    // Unauthorized credentials must not trigger an address failover.
    private func failureMessage(for error: Error) -> String {
        guard let connection else { return error.localizedDescription }
        let failed = rotation.currentEndpoint ?? connection.activeEndpoint ??
            CompanionEndpoint.direct(host: connection.host, port: connection.port, priority: 10_000)
        var next: String?
        if let candidate = rotation.advanceEndpoint(after: error), let token {
            client = CompanionClient(connection: connection.dialing(candidate), token: token)
            next = candidate.displayAddress
            log.info("advancing to companion route \(candidate.url, privacy: .public)")
        }
        if let urlError = error as? URLError {
            return ConnectionAdvice.message(
                for: urlError.code,
                host: failed?.displayAddress ?? connection.host,
                port: failed?.port ?? connection.port,
                tryingNext: next
            )
        }
        if let apiError = error as? APIError,
           case let .status(code, _) = apiError,
           ConnectionAdvice.shouldTryAnotherRoute(after: error) {
            return ConnectionAdvice.message(
                forGatewayStatus: code,
                host: failed?.displayAddress ?? connection.host,
                tryingNext: next
            )
        }
        return error.localizedDescription
    }

    private func rememberWorkingRoute() {
        guard let winner = rotation.currentEndpoint, var updated = connection,
              updated.activeEndpoint?.url != winner.url else { return }
        updated.promote(winner)
        persistActiveConnection(updated)
    }

    /// Learn routes enabled after this phone originally paired. The endpoint
    /// response is authenticated with the existing device token and is a
    /// replacement snapshot, but failure is deliberately non-fatal: older
    /// sidecars return 404 and a transient refresh error must not tear down a
    /// perfectly healthy event stream.
    private func refreshConnectionMetadata(using sourceClient: CompanionClient) {
        guard connection?.pairedWithServer != true, let connectionID = connection?.id else { return }
        let workingEndpoint = rotation.currentEndpoint ?? sourceClient.connection.activeEndpoint
        endpointRefreshTask?.cancel()
        endpointRefreshTask = Task { [weak self] in
            do {
                let metadata = try await sourceClient.connectionMetadata()
                try Task.checkCancellation()
                guard let self,
                      self.connection?.id == connectionID,
                      self.client?.connection.baseURL == sourceClient.connection.baseURL,
                      var updated = self.connection
                else { return }

                updated.reconcile(metadata)
                self.persistActiveConnection(updated)

                // An authenticated live connection must not be downgraded to cleartext.
                let liveRoutes = workingEndpoint.map { route in
                    [route] + updated.orderedEndpoints.filter { $0.url != route.url }
                } ?? updated.orderedEndpoints
                self.rotation = CandidateRotation(endpoints: liveRoutes)
                log.info("refreshed \(metadata.endpoints.count, privacy: .public) companion routes")
            } catch is CancellationError {
                return
            } catch {
                log.debug("endpoint refresh unavailable: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    @discardableResult
    func updateAddress(_ text: String) -> Bool {
        guard var updated = connection, let parsed = Connection.parse(text) else { return false }
        guard let endpoint = parsed.activeEndpoint ?? CompanionEndpoint.direct(
            host: parsed.host,
            port: parsed.port,
            priority: 0
        ) else { return false }
        updated.resetRoutePolicy(selecting: endpoint)
        persistActiveConnection(updated)
        rotation = CandidateRotation(endpoints: updated.orderedEndpoints)
        if let token {
            client = CompanionClient(connection: updated.dialing(endpoint), token: token)
        }
        restartStream()
        connect()
        return true
    }


    func send(_ text: String, to chat: Chat) async {
        let generation = runtimeGeneration
        await perform { client in
            let queueRevision = chat.isBot ? self.state.botQueueRevision : nil
            let receipt: SendReceipt
            switch chat {
            case let .bot(bot):
                receipt = try await client.send(text: text, toBot: bot.id, threadId: bot.threadId)
            case let .room(room):
                receipt = try await client.send(text: text, toRoom: room.id, threadId: room.threadId)
            }
            try self.requireCurrent(client, generation: generation)
            self.record(receipt, text: text, fallbackThreadId: chat.threadId, botQueueRevision: queueRevision)
        }
    }

    private func record(_ receipt: SendReceipt, text: String, fallbackThreadId: String, botQueueRevision: Int?) {
        guard case let .queued(queueId, threadId) = receipt else { return }
        state.rememberQueued(
            QueuedSend(queueId: queueId, text: text),
            inThread: threadId.isEmpty ? fallbackThreadId : threadId,
            ifBotQueueRevisionMatches: botQueueRevision
        )
    }

    func send(
        text: String,
        attachments: [PendingMessageAttachment],
        to chat: Chat
    ) async -> Bool {
        guard let client else {
            actionError = AppLanguage.message("This computer is offline.")
            return false
        }
        let generation = runtimeGeneration
        actionError = nil
        do {
            try AttachmentPolicy.validate(attachments)
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty || !attachments.isEmpty else {
                actionError = AppLanguage.message("Write a message or attach a file first.")
                return false
            }

            if attachments.contains(where: { $0.kind == .image }) {
                let capable: Set<String>
                do {
                    capable = try await client.imageCapableInstanceIDs()
                } catch APIError.status(code: 404, message: _) {
                    try requireCurrent(client, generation: generation)
                    actionError = AppLanguage.message("Update StartupBot on this computer before sending images.")
                    return false
                }
                try requireCurrent(client, generation: generation)
                guard imageSupported(by: chat, capableInstances: capable) else {
                    actionError = imageCompatibilityMessage(for: chat)
                    return false
                }
            }

            let destination: MessageDestination
            switch chat {
            case let .bot(bot):
                destination = .bot(id: bot.id, threadId: bot.threadId)
            case let .room(room):
                destination = .room(id: room.id, threadId: room.threadId)
            }
            let draftKey = AttachmentDraftKey(
                destination: destination,
                text: text,
                attachmentIDs: attachments.map(\.id)
            )
            if attachmentSendIDs.count >= 20, attachmentSendIDs[draftKey] == nil {
                attachmentSendIDs.removeAll(keepingCapacity: true)
            }
            let sendID = attachmentSendIDs[draftKey] ?? UUID().uuidString
            attachmentSendIDs[draftKey] = sendID

            var uploaded: [SharedAttachmentReference] = []
            uploaded.reserveCapacity(attachments.count)
            for attachment in attachments {
                try Task.checkCancellation()
                let mime = AttachmentPolicy.normalizedMIME(attachment.mime)
                switch attachment.kind {
                case .image:
                    let path = try await client.uploadImage(
                        data: attachment.data,
                        mime: mime,
                        uploadId: attachment.id.uuidString
                    )
                    try requireCurrent(client, generation: generation)
                    uploaded.append(SharedAttachmentReference(
                        path: path,
                        kind: .image,
                        displayName: attachment.name
                    ))
                case .file:
                    let file = try await client.uploadFile(
                        data: attachment.data,
                        name: attachment.name,
                        mime: mime,
                        uploadId: attachment.id.uuidString
                    )
                    try requireCurrent(client, generation: generation)
                    uploaded.append(SharedAttachmentReference(
                        path: file.path,
                        kind: .file,
                        displayName: file.name
                    ))
                }
            }

            let message = SharedMessageComposer.compose(
                instruction: text,
                text: [],
                urls: [],
                attachments: uploaded
            )
            let queueRevision = chat.isBot ? state.botQueueRevision : nil
            let receipt = try await client.send(text: message, to: destination, sendId: sendID)
            try requireCurrent(client, generation: generation)
            record(
                receipt,
                text: trimmed.isEmpty ? message : trimmed,
                fallbackThreadId: chat.threadId,
                botQueueRevision: queueRevision
            )
            attachmentSendIDs.removeValue(forKey: draftKey)
            actionError = nil
            return true
        } catch is CancellationError {
            return false
        } catch let error as APIError where error.isUnauthorized {
            guard isCurrent(client, generation: generation) else { return false }
            status = .unauthorized
            actionError = error.localizedDescription
            return false
        } catch {
            guard isCurrent(client, generation: generation) else { return false }
            actionError = error.localizedDescription
            return false
        }
    }

    private func imageSupported(by chat: Chat, capableInstances: Set<String>) -> Bool {
        switch chat {
        case let .bot(bot):
            return capableInstances.contains(bot.currentTaskModelSelection.instanceId)
        case let .room(room):
            return !room.memberIds.isEmpty && room.memberIds.allSatisfy { id in
                guard let bot = state.bot(id) else { return false }
                return capableInstances.contains(bot.modelSelection.instanceId)
            }
        }
    }

    private func imageCompatibilityMessage(for chat: Chat) -> String {
        switch chat {
        case let .bot(bot):
            return "\(bot.name)'s current model doesn't support images. Choose another model or remove the image."
        case .room:
            return AppLanguage.message("Every bot that may answer in this channel must use a model that supports images.")
        }
    }

    func fetchAttachment(
        threadId: String,
        messageId: String,
        path: String,
        cacheResult: Bool = false
    ) async throws -> DownloadedFile {
        guard let client else {
            throw APIError.transport(AppLanguage.message("This computer is offline."))
        }
        let cacheKey = "\(threadId)\u{1F}\(messageId)\u{1F}\(path)"
        if cacheResult,
           let cached = attachmentCache.object(forKey: cacheKey as NSString) {
            return cached.value
        }
        let generation = attachmentCacheGeneration
        do {
            let download = try await client.downloadFile(
                threadId: threadId,
                messageId: messageId,
                path: path
            )
            try Task.checkCancellation()
            guard generation == attachmentCacheGeneration else { throw CancellationError() }
            if cacheResult {
                attachmentCache.setObject(
                    CachedAttachmentDownload(download),
                    forKey: cacheKey as NSString,
                    cost: download.data.count
                )
            }
            return download
        } catch let error as APIError where error.isUnauthorized {
            // An old computer's unauthorized response cannot invalidate the selected computer's session.
            guard generation == attachmentCacheGeneration, !Task.isCancelled else {
                throw CancellationError()
            }
            status = .unauthorized
            throw error
        } catch {
            if Task.isCancelled || generation != attachmentCacheGeneration {
                throw CancellationError()
            }
            throw error
        }
    }

    func prepareAttachmentPreview(
        threadId: String,
        messageId: String,
        path: String,
        cacheResult: Bool = false
    ) async throws -> DownloadedFile {
        let generation = attachmentCacheGeneration
        let download = try await fetchAttachment(
            threadId: threadId,
            messageId: messageId,
            path: path,
            cacheResult: cacheResult
        )
        try Task.checkCancellation()
        let preparation = Task.detached(priority: .userInitiated) {
            try Self.materializePreview(download: download, filename: download.filename)
        }
        let prepared = try await withTaskCancellationHandler {
            try await preparation.value
        } onCancel: {
            preparation.cancel()
        }
        do {
            try Task.checkCancellation()
            guard generation == attachmentCacheGeneration else { throw CancellationError() }
            return prepared
        } catch {
            Self.removePreview(at: prepared.localURL)
            throw error
        }
    }

    func downloadFile(
        threadId: String,
        messageId: String,
        path: String
    ) async -> DownloadedFile? {
        let generation = attachmentCacheGeneration
        actionError = nil
        do {
            let download = try await prepareAttachmentPreview(
                threadId: threadId,
                messageId: messageId,
                path: path
            )
            actionError = nil
            return download
        } catch is CancellationError {
            return nil
        } catch {
            if !Task.isCancelled, generation == attachmentCacheGeneration { actionError = error.localizedDescription }
            return nil
        }
    }

    private func resetAttachmentCache() {
        attachmentCacheGeneration += 1
        attachmentCache.removeAllObjects()
    }

    nonisolated private static func materializePreview(
        download: DownloadedFile,
        filename: String
    ) throws -> DownloadedFile {
        let manager = FileManager.default
        let root = manager.temporaryDirectory
            .appendingPathComponent("OpenMausBotFilePreviews", isDirectory: true)
        let directory = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try Task.checkCancellation()
        try manager.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        let fileURL = directory.appendingPathComponent(filename, isDirectory: false)
        do {
            try download.data.write(
                to: fileURL,
                options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
            )
            try Task.checkCancellation()
            return DownloadedFile(
                data: download.data,
                filename: filename,
                contentType: download.contentType,
                localURL: fileURL
            )
        } catch {
            try? manager.removeItem(at: directory)
            throw error
        }
    }

    nonisolated private static func removePreview(at fileURL: URL?) {
        guard let fileURL else { return }
        try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent())
    }

    private static func removeStaleFilePreviews() {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("OpenMausBotFilePreviews", isDirectory: true)
        try? FileManager.default.removeItem(at: root)
    }

    func answer(chat: Chat, card: OptionCard, choice: String, rememberingPermission: Bool = false) async {
        let generation = runtimeGeneration
        guard let requestId = card.requestId else { return }
        let behavior = OptionCard.responseBehavior(for: choice, isPermission: card.isPermission)
        await perform { client in
            if rememberingPermission || card.shouldRememberPermission(for: choice) {
                guard card.isPermission, behavior == "allow", let key = card.allowKey, case let .bot(bot) = chat else {
                    throw APIError.status(code: 409, message: AppLanguage.message("This request cannot create a standing permission."))
                }
                try await client.alwaysAllow(botId: bot.id, key: key, threadId: chat.threadId)
                try self.requireCurrent(client, generation: generation)
            }
            try await client.respond(
                threadId: chat.threadId,
                requestId: requestId,
                behavior: behavior,
                message: behavior == "answer" ? choice : nil,
                reviewedSha256: behavior == "allow" ? card.skillRequest?.reviewedSha256 : nil
            )
        }
    }

    /// Synchronously seal a credential before the caller starts an async
    /// request. The caller can then erase its input immediately and retain
    /// only this ciphertext value for an exact, idempotent retry.
    func prepareCredential(
        _ value: String,
        chat: Chat,
        message: Message,
        secret: SecretRequestCardData
    ) throws -> PreparedPhoneCredential {
        guard let client, let connection else {
            throw APIError.transport(AppLanguage.message("This computer is offline."))
        }
        guard let publicKey = connection.secretPublicKey,
              let deviceId = connection.companionDeviceId,
              let target = secret.target,
              let requestKey = secret.requestKey
        else { throw PhoneSecretError.unavailable }
        guard client.connection.activeEndpoint?.protectsCredentials == true else {
            throw PhoneSecretError.insecureTransport
        }

        let botId = try credentialBotID(chat: chat, message: message)
        let context = PhoneSecretRequestContext(
            deviceId: deviceId,
            botId: botId,
            threadId: chat.threadId,
            messageId: message.id,
            target: target,
            requestKey: requestKey
        )
        let keyId = try PhoneSecretCrypto.publicKeyId(publicKey)
        let requestIdentity = phoneCredentialRequestIdentity(
            connectionID: connection.id,
            botID: botId,
            context: context,
            keyID: keyId
        )
        if let prepared = preparedPhoneCredentials[requestIdentity] {
            return prepared
        }
        let envelope = try PhoneSecretCrypto.encrypt(
            value,
            publicKey: publicKey,
            context: context
        )

        let prepared = PreparedPhoneCredential(
            requestIdentity: requestIdentity,
            connectionID: connection.id,
            botID: botId,
            messageID: message.id,
            envelope: envelope
        )
        preparedPhoneCredentials[requestIdentity] = prepared
        return prepared
    }

    func preparedCredential(
        chat: Chat,
        message: Message,
        secret: SecretRequestCardData
    ) -> PreparedPhoneCredential? {
        guard let connection,
              let publicKey = connection.secretPublicKey,
              let deviceId = connection.companionDeviceId,
              let target = secret.target,
              let requestKey = secret.requestKey,
              let botId = try? credentialBotID(chat: chat, message: message),
              let keyId = try? PhoneSecretCrypto.publicKeyId(publicKey)
        else { return nil }
        let context = PhoneSecretRequestContext(
            deviceId: deviceId,
            botId: botId,
            threadId: chat.threadId,
            messageId: message.id,
            target: target,
            requestKey: requestKey
        )
        return preparedPhoneCredentials[phoneCredentialRequestIdentity(
            connectionID: connection.id,
            botID: botId,
            context: context,
            keyID: keyId
        )]
    }

    func discardPreparedCredential(_ prepared: PreparedPhoneCredential) {
        if preparedPhoneCredentials[prepared.requestIdentity] == prepared {
            preparedPhoneCredentials.removeValue(forKey: prepared.requestIdentity)
        }
    }

    private func credentialBotID(chat: Chat, message: Message) throws -> String {
        switch chat {
        case let .bot(bot): return bot.id
        case .room:
            guard let sender = message.from?.botId else {
                throw PhoneSecretError.invalidRequest
            }
            return sender
        }
    }

    private func phoneCredentialRequestIdentity(
        connectionID: String,
        botID: String,
        context: PhoneSecretRequestContext,
        keyID: String
    ) -> String {
        [
            connectionID,
            keyID,
            botID,
            context.threadId,
            context.messageId,
            context.target,
            context.requestKey,
        ].joined(separator: "\u{0}")
    }

    func provideCredential(_ prepared: PreparedPhoneCredential) async throws {
        let requestGeneration = runtimeGeneration
        guard let client, let connection else {
            throw APIError.transport(AppLanguage.message("This computer is offline."))
        }
        guard connection.id == prepared.connectionID,
              connection.companionDeviceId == prepared.envelope.deviceId,
              let publicKey = connection.secretPublicKey,
              (try? PhoneSecretCrypto.publicKeyId(publicKey)) == prepared.envelope.keyId
        else { throw PhoneSecretError.unavailable }
        guard client.connection.activeEndpoint?.protectsCredentials == true else {
            throw PhoneSecretError.insecureTransport
        }

        do {
            try currentResult(try await client.provideCredential(
                botId: prepared.botID,
                messageId: prepared.messageID,
                envelope: prepared.envelope
            ), using: client, generation: requestGeneration)
        } catch {
            try requireCurrent(client, generation: requestGeneration)
            if (error as? APIError)?.isUnauthorized == true { status = .unauthorized }
            throw error
        }
    }

    func answer(
        threadId: String,
        requestId: String,
        choice: String,
        isPermission: Bool,
        reviewedSha256: String? = nil,
        originConnectionID: String? = nil
    ) async {
        await perform {
            if let originConnectionID, $0.connection.id != originConnectionID {
                throw APIError.status(code: 409, message: AppLanguage.message("Select the computer that sent this request before answering it."))
            }
            // Permission cards answer allow/deny; a question answers with
            // the chosen text. The harness tells them apart by `behavior`.
            let behavior = OptionCard.responseBehavior(for: choice, isPermission: isPermission)
            if behavior != "answer" {
                try await $0.respond(
                    threadId: threadId,
                    requestId: requestId,
                    behavior: behavior,
                    reviewedSha256: behavior == "allow" ? reviewedSha256 : nil
                )
            } else {
                try await $0.respond(threadId: threadId, requestId: requestId, behavior: "answer", message: choice)
            }
        }
    }

    func answerQuestions(chat: Chat, card: OptionCard, form: QuestionAnswerForm) async -> Bool {
        guard let client, card.isPending, !card.isPermission, let request = card.questionRequest,
              let requestID = card.requestId, let answer = form.answer(in: request) else { return false }
        let generation = runtimeGeneration
        do {
            try currentResult(try await client.respond(threadId: chat.threadId, requestId: requestID, behavior: "answer", message: answer), using: client, generation: generation)
            return true
        } catch {
            guard isCurrent(client, generation: generation) else { return false }
            if (error as? APIError)?.isUnauthorized == true { status = .unauthorized }
            actionError = error.localizedDescription
            return false
        }
    }

    @discardableResult
    func createBot() async -> Bot? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        do {
            let bot = try currentResult(try await client.createBot(), using: client, generation: requestGeneration)
            state.apply(.bot(bot))
            return bot
        } catch {
            if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }
            return nil
        }
    }

    @discardableResult
    func createRoom(name: String?, memberIds: [String]) async -> Room? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        do {
            let room = try currentResult(try await client.createRoom(name: name, memberIds: memberIds), using: client, generation: requestGeneration)
            state.apply(.room(room))
            return room
        } catch {
            if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }
            return nil
        }
    }

    @discardableResult
    func assignSection(name: String, botIds: [String]) async -> [Bot]? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        do {
            let bots = try currentResult(try await client.assignSection(name: name, botIds: botIds), using: client, generation: requestGeneration)
            for bot in bots { state.apply(.bot(bot)) }
            return bots
        } catch {
            if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }
            return nil
        }
    }

    func interrupt(bot: Bot) async {
        await perform { try await $0.interrupt(botId: bot.id, threadId: bot.threadId) }
    }

    func cancelQueued(_ send: QueuedSend, in chat: Chat) async {
        let requestGeneration = runtimeGeneration
        guard let client else { return }
        let threadId = chat.threadId
        let destination: MessageDestination
        switch chat {
        case let .bot(bot): destination = .bot(id: bot.id, threadId: threadId)
        case let .room(room): destination = .room(id: room.id, threadId: threadId)
        }
        do {
            try currentResult(try await client.cancelQueued(send.queueId, to: destination), using: client, generation: requestGeneration)
            state.forgetQueued(send.queueId, inThread: threadId)
        } catch let error as APIError where error.isUnauthorized {
            if isCurrent(client, generation: requestGeneration) { status = .unauthorized }
        } catch {
            if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }
        }
    }

    func cloudDesktop(for bot: Bot) async throws -> URL {
        let requestGeneration = runtimeGeneration
        guard let client else { throw APIError.transport(AppLanguage.message("This computer is offline.")) }
        do {
            return try currentResult(try await client.cloudDesktop(botId: bot.id), using: client, generation: requestGeneration).url
        } catch {
            try requireCurrent(client, generation: requestGeneration)
            if (error as? APIError)?.isUnauthorized == true { status = .unauthorized }
            throw error
        }
    }

    func markRead(_ chat: Chat) async {
        await perform(quietly: true) {
            switch chat {
            case let .bot(bot): try await $0.markRead(botId: bot.id, threadId: bot.threadId)
            case let .room(room): try await $0.markRead(roomId: room.id, threadId: room.threadId)
            }
        }
    }

    func loadOlder(threadId: String) async {
        let requestGeneration = runtimeGeneration
        guard let client, let oldest = state.transcript(forThread: threadId).first else { return }
        let revision = state.clearRevisions[threadId]
        do {
            let page = try currentResult(try await client.messages(threadId: threadId, before: oldest.id, limit: 50), using: client, generation: requestGeneration)
            guard state.clearRevisions[threadId] == revision else { return }
            state.prepend(page, toThread: threadId)
        } catch {
            if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }
        }
    }

    func loadThreadIfNeeded(_ threadId: String) async {
        let requestGeneration = runtimeGeneration
        guard let client, !state.hasLoadedPage(forThread: threadId) else { return }
        let revision = state.clearRevisions[threadId]
        do {
            let page = try currentResult(try await client.messages(threadId: threadId), using: client, generation: requestGeneration)
            guard state.clearRevisions[threadId] == revision else { return }
            state.merge(page, intoThread: threadId)
        } catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription } }
    }

    func image(threadId: String, messageId: String) async -> Data? {
        guard let client else { return nil }
        let generation = runtimeGeneration
        return try? currentResult(try await client.image(threadId: threadId, messageId: messageId), using: client, generation: generation)
    }

    func search(_ query: String) async -> [SearchHit] {
        let requestGeneration = runtimeGeneration
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2, let client else { return [] }
        do { return try currentResult(try await client.search(trimmed), using: client, generation: requestGeneration) }
        catch {
            if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }
            return []
        }
    }

    func open(_ hit: SearchHit) async -> Chat? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        do {
            if let botId = hit.botId, var bot = state.bot(botId) {
                if bot.threadId != hit.threadId {
                    bot = try currentResult(try await switchBotTask(using: client, botId: bot.id, threadId: hit.threadId), using: client, generation: requestGeneration)
                }
                if !hit.onActivePath {
                    let leaf = try currentResult(try await client.setActiveBranch(botId: bot.id, messageId: hit.messageId, threadId: hit.threadId), using: client, generation: requestGeneration)
                    state.apply(.thread(threadId: hit.threadId, activeLeafId: leaf))
                }
                try await connectSearchHistory(hit, using: client, generation: requestGeneration)
                focusedMessageId = hit.messageId
                return state.bot(forThread: hit.threadId).map(Chat.bot)
            }
            if let groupId = hit.groupId,
               var room = state.rooms.first(where: { $0.id == groupId }) {
                if room.threadId != hit.threadId {
                    room = try currentResult(try await client.switchTask(groupId: room.id, threadId: hit.threadId), using: client, generation: requestGeneration)
                    state.apply(.room(room))
                }
                try await connectSearchHistory(hit, using: client, generation: requestGeneration)
                focusedMessageId = hit.messageId
                return state.rooms.first(where: { $0.id == groupId }).map(Chat.room)
            }
        } catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription } }
        return nil
    }

    private func connectSearchHistory(_ hit: SearchHit, using client: CompanionClient, generation: Int) async throws {
        var landing = SearchLanding(threadID: hit.threadId, messageID: hit.messageId)
        guard isCurrent(client, generation: generation) else { throw CancellationError() }
        if landing.isRendered(in: state) { return }
        let revision = state.clearRevisions[hit.threadId]
        var leafAtRequest = landing.leaf(in: state)
        var page = try currentResult(try await client.messages(threadId: hit.threadId, around: hit.messageId), using: client, generation: generation)
        guard state.clearRevisions[hit.threadId] == revision else { throw CancellationError() }
        state = try landing.merge(page, into: state, leafAtRequest: leafAtRequest)
        while let cursor = try landing.next(in: state) {
            leafAtRequest = landing.leaf(in: state)
            switch cursor {
            case .latest:
                page = try currentResult(try await client.messages(threadId: hit.threadId, limit: 200), using: client, generation: generation)
            case let .around(parent):
                page = try currentResult(try await client.messages(threadId: hit.threadId, around: parent, limit: 200), using: client, generation: generation)
            }
            guard state.clearRevisions[hit.threadId] == revision else { throw CancellationError() }
            state = try landing.merge(page, into: state, leafAtRequest: leafAtRequest)
        }
    }

    func consumeFocus(_ messageId: String) {
        if focusedMessageId == messageId { focusedMessageId = nil }
    }

    @discardableResult
    func createTask(for bot: Bot, title: String?) async -> Bot? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        do {
            let updated = try currentResult(try await client.createTask(botId: bot.id, title: title), using: client, generation: requestGeneration)
            state.apply(.bot(updated))
            return updated
        } catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }; return nil }
    }

    private func switchBotTask(using client: CompanionClient, botId: String, threadId: String) async throws -> Bot {
        let revision = state.clearRevisions[threadId]
        let generation = runtimeGeneration
        let stream = streamGeneration
        let bot = try await client.switchTask(botId: botId, threadId: threadId)
        try requireCurrent(client, generation: generation)
        guard stream == streamGeneration, state.clearRevisions[threadId] == revision else { throw CancellationError() }
        guard bot.threadId == threadId else { throw APIError.status(code: 409, message: AppLanguage.message("That task could not be opened. Try again.")) }
        state.apply(.bot(bot))
        return bot
    }

    @discardableResult
    func switchTask(_ task: BotTask, for bot: Bot) async -> Bot? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        do {
            let updated = try currentResult(try await switchBotTask(using: client, botId: bot.id, threadId: task.threadId), using: client, generation: requestGeneration)
            return updated
        } catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }; return nil }
    }

    @discardableResult
    func renameTask(_ task: BotTask, for bot: Bot, title: String) async -> Bool {
        let requestGeneration = runtimeGeneration
        guard let client else { return false }
        do {
            try currentResult(try await client.renameTask(botId: bot.id, threadId: task.threadId, title: title), using: client, generation: requestGeneration)
            await refresh()
            try requireCurrent(client, generation: requestGeneration)
            return true
        } catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }; return false }
    }

    @discardableResult
    func deleteTask(_ task: BotTask, for bot: Bot) async -> Bot? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        do {
            let updated = try currentResult(try await client.deleteTask(botId: bot.id, threadId: task.threadId), using: client, generation: requestGeneration)
            state.apply(.bot(updated))
            return updated
        } catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }; return nil }
    }

    @discardableResult
    func createTask(for room: Room, title: String?) async -> Bool {
        let requestGeneration = runtimeGeneration
        guard let client else { return false }
        do { state.apply(.room(try currentResult(try await client.createTask(groupId: room.id, title: title), using: client, generation: requestGeneration))); return true }
        catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }; return false }
    }

    @discardableResult
    func switchTask(_ task: BotTask, for room: Room) async -> Bool {
        let requestGeneration = runtimeGeneration
        guard task.threadId != room.threadId else { return true }
        guard let client else { return false }
        do { state.apply(.room(try currentResult(try await client.switchTask(groupId: room.id, threadId: task.threadId), using: client, generation: requestGeneration))); return true }
        catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }; return false }
    }

    @discardableResult
    func renameTask(_ task: BotTask, for room: Room, title: String) async -> Bool {
        let requestGeneration = runtimeGeneration
        guard let client else { return false }
        do {
            try currentResult(try await client.renameTask(groupId: room.id, threadId: task.threadId, title: title), using: client, generation: requestGeneration)
            await refresh()
            try requireCurrent(client, generation: requestGeneration)
            return true
        } catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }; return false }
    }

    @discardableResult
    func deleteTask(_ task: BotTask, for room: Room) async -> Bool {
        let requestGeneration = runtimeGeneration
        guard let client else { return false }
        do { state.apply(.room(try currentResult(try await client.deleteTask(groupId: room.id, threadId: task.threadId), using: client, generation: requestGeneration))); return true }
        catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }; return false }
    }

    func modelInstances() async -> [Instance] {
        let requestGeneration = runtimeGeneration
        guard let client else { return [] }
        do {
            return try currentResult(try await client.instances(), using: client, generation: requestGeneration)
        } catch {
            if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }
            return []
        }
    }

    func updateModel(_ selection: ModelSelection, for bot: Bot) async -> Bot? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        do {
            let updated = try currentResult(try await client.updateModel(botId: bot.id, selection: selection, threadId: bot.threadId), using: client, generation: requestGeneration)
            guard !Task.isCancelled else { return nil }
            state.apply(.bot(updated))
            return updated
        } catch {
            if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }
            return nil
        }
    }

    func updateProfile(_ patch: BotProfilePatch, for bot: Bot) async -> Bot? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        do {
            let updated = try currentResult(try await client.updateProfile(botId: bot.id, patch: patch), using: client, generation: requestGeneration)
            guard !Task.isCancelled else { return nil }
            state.apply(.bot(updated))
            return updated
        } catch {
            if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }
            return nil
        }
    }

    func uploadAvatar(_ data: Data, mime: String, for bot: Bot, crop: AvatarCrop) async -> Bot? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        do {
            let avatarUrl = try currentResult(try await client.uploadAvatar(data: data, mime: mime), using: client, generation: requestGeneration)
            guard !Task.isCancelled else { return nil }
            let current = state.bot(bot.id) ?? bot
            return await updateProfile(
                BotProfilePatch(avatarUrl: .set(avatarUrl), avatarCrop: crop),
                for: current
            )
        } catch {
            if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }
            return nil
        }
    }

    func generateAvatar(prompt: String, for bot: Bot) async -> Bot? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        do {
            let updated = try currentResult(try await client.generateAvatar(botId: bot.id, prompt: prompt), using: client, generation: requestGeneration)
            guard !Task.isCancelled else { return nil }
            state.apply(.bot(updated))
            return updated
        } catch {
            if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }
            return nil
        }
    }

    func avatarData(for bot: Bot) async -> Data? {
        guard let path = bot.avatarUrl, let client else { return nil }
        let key = path as NSString
        if let cached = avatarCache.object(forKey: key) { return cached as Data }
        let generation = avatarCacheGeneration
        let fetch: (id: UUID, task: Task<Data?, Never>)
        if let pending = avatarFetches[path] {
            fetch = pending
        } else {
            let pending = (
                id: UUID(),
                task: Task<Data?, Never> { try? await client.avatar(path: path) }
            )
            avatarFetches[path] = pending
            fetch = pending
        }
        let data = await fetch.task.value
        if avatarFetches[path]?.id == fetch.id { avatarFetches.removeValue(forKey: path) }
        guard !Task.isCancelled, generation == avatarCacheGeneration, let data else { return nil }
        avatarCache.setObject(data as NSData, forKey: key, cost: data.count)
        return data
    }

    private func resetAvatarCache() {
        avatarCacheGeneration += 1
        for fetch in avatarFetches.values { fetch.task.cancel() }
        avatarFetches.removeAll()
        avatarCache.removeAllObjects()
    }

    func voiceOptions() async -> [Voice] {
        let generation = runtimeGeneration
        guard let client else { return [] }
        do { return try currentResult(try await client.voices(), using: client, generation: generation) }
        catch { if isCurrent(client, generation: generation) { actionError = error.localizedDescription }; return [] }
    }

    func previewVoice(_ voiceId: String, for bot: Bot) async -> Data? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        do { return try currentResult(try await client.previewVoice(text: "Hello, I'm \(bot.name).", voiceId: voiceId), using: client, generation: requestGeneration) }
        catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }; return nil }
    }

    func aiTwin() async -> AiTwinStatus? {
        let generation = runtimeGeneration
        guard let client else { return nil }
        return try? currentResult(try await client.aiTwin(), using: client, generation: generation)
    }

    func askAiTwin(_ profile: AiTwinProfile, question: String, action: AiTwinAction, provider: AiTwinProvider?) async -> AiTwinAnswer? {
        let generation = runtimeGeneration
        guard let client else { return nil }
        return try? currentResult(try await client.askAiTwin(profile, question: question, action: action, provider: provider),
                                  using: client, generation: generation)
    }

    func configStatus() async -> ConfigStatus? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        return try? currentResult(try await client.config(), using: client, generation: requestGeneration)
    }

    func botOverview(for bot: Bot) async -> BotOverview? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        let connectionID = connection?.id
        do {
            let overview = try currentResult(try await client.overview(botId: bot.id), using: client, generation: requestGeneration)
            guard !Task.isCancelled, connection?.id == connectionID else { return nil }
            return overview
        } catch {
            guard !Task.isCancelled, connection?.id == connectionID else { return nil }
            guard !(error is CancellationError), (error as? URLError)?.code != .cancelled else { return nil }
            if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }
            return nil
        }
    }


    func loadRoutines() async -> (routines: [Routine], runs: [RoutineRun]) {
        let requestGeneration = runtimeGeneration
        guard let client else { return ([], []) }
        do { return try currentResult(try await client.routines(), using: client, generation: requestGeneration) }
        catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }; return ([], []) }
    }

    func loadRoutineRunAvailability() async -> RoutineRunAvailability? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        do {
            async let config = client.config()
            async let instances = client.instances()
            let availability = try await RoutineRunAvailability(config: config, instances: instances)
            try requireCurrent(client, generation: requestGeneration)
            return availability
        } catch {
            if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }
            return nil
        }
    }

    func saveRoutine(_ input: RoutineInput, id: String?) async -> Routine? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        do {
            if let id { return try currentResult(try await client.updateRoutine(id: id, input: input), using: client, generation: requestGeneration) }
            return try currentResult(try await client.createRoutine(input), using: client, generation: requestGeneration)
        } catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }; return nil }
    }

    func setRoutineEnabled(_ routine: Routine, enabled: Bool) async -> Routine? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        do { return try currentResult(try await client.setRoutineEnabled(id: routine.id, enabled: enabled), using: client, generation: requestGeneration) }
        catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }; return nil }
    }

    func runRoutine(_ routine: Routine) async -> RoutineRun? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        do { return try currentResult(try await client.runRoutine(id: routine.id), using: client, generation: requestGeneration) }
        catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }; return nil }
    }

    func deleteRoutine(_ routine: Routine) async -> Bool {
        let requestGeneration = runtimeGeneration
        guard let client else { return false }
        do { try currentResult(try await client.deleteRoutine(id: routine.id), using: client, generation: requestGeneration); return true }
        catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }; return false }
    }


    func confirmNotificationComputer(_ target: NotificationTarget) async {
        guard let id = target.connectionID, registry.connection(id: id) != nil else { return }
        switchComputer(to: id)
        guard connection?.id == id else { return }
        await openNotification(target)
    }

    func openNotification(_ target: NotificationTarget) async {
        guard let origin = target.connectionID else {
            actionError = AppLanguage.message("This notification has no saved computer. Open the conversation from your computer list.")
            return
        }
        notificationComputer = nil
        guard origin == connection?.id else {
            if registry.connection(id: origin) != nil {
                notificationComputer = target
                return
            }
            actionError = AppLanguage.message("This notification is from another computer. Select that computer and open it again.")
            return
        }
        let requestGeneration = runtimeGeneration
        guard let client else {
            // Do not carry a stale destination into a future, unrelated
            // pairing. Only a saved connection waiting for Keychain access is
            // eligible for replay.
            if restorePending {
                pendingNotification = target
                connect()
            } else {
                actionError = AppLanguage.message("Pair this device with your computer to open that task.")
            }
            return
        }
        pendingNotification = nil
        do {
            var bot = state.bot(target.botId)
            if bot == nil {
                try await hydrate(using: client)
                try requireCurrent(client, generation: requestGeneration)
                bot = state.bot(target.botId)
            }
            if var room = state.rooms.first(where: {
                $0.threadId == target.threadId || ($0.tasks ?? []).contains(where: { $0.threadId == target.threadId })
            }) {
                if room.threadId != target.threadId {
                    room = try currentResult(try await client.switchTask(groupId: room.id, threadId: target.threadId), using: client, generation: requestGeneration)
                    guard room.threadId == target.threadId else { throw APIError.status(code: 409, message: AppLanguage.message("That task could not be opened. Try again.")) }
                    state.apply(.room(room))
                }
                notificationChat = .room(room)
                return
            }
            guard var selected = bot else { throw APIError.status(code: 404, message: AppLanguage.message("That agent no longer exists.")) }
            if target.requiresTaskSwitch(activeThreadId: selected.threadId) {
                selected = try currentResult(try await switchBotTask(using: client, botId: selected.id, threadId: target.threadId), using: client, generation: requestGeneration)
                guard selected.threadId == target.threadId else { throw APIError.status(code: 409, message: AppLanguage.message("That task could not be opened. Try again.")) }
            }
            notificationChat = .bot(selected)
        } catch is CancellationError {
        } catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription } }
    }

    func consumeNotificationChat() { notificationChat = nil }

    func openThread(_ ref: ThreadRef, shownBotId: String?) async -> String? {
        guard !Task.isCancelled else { return nil }
        guard let client else {
            actionError = AppLanguage.message("Pair this device with your computer to open that thread.")
            return nil
        }
        let generation = streamGeneration
        let connectionID = client.connection.id
        let requestIsCurrent = {
            !Task.isCancelled && self.streamGeneration == generation && self.client?.connection.id == connectionID
        }
        actionError = nil
        do {
            var bot = state.bot(ref.botId)
            if bot == nil {
                try await hydrate(using: client)
                guard requestIsCurrent() else { return nil }
                bot = state.bot(ref.botId)
            }
            guard var selected = bot else { throw APIError.status(code: 404, message: AppLanguage.message("That agent no longer exists.")) }
            if selected.threadId != ref.threadId {
                do {
                    selected = try await switchBotTask(using: client, botId: selected.id, threadId: ref.threadId)
                    guard requestIsCurrent() else { return nil }
                } catch APIError.status(code: 404, message: _) {
                    guard requestIsCurrent() else { return nil }
                    actionError = AppLanguage.message("That thread is no longer on your computer.")
                    return nil
                }
            }
            guard requestIsCurrent() else { return nil }
            if selected.id == shownBotId { return selected.threadId }
            notificationChat = .bot(selected)
        } catch is CancellationError {
        } catch {
            guard requestIsCurrent() else { return nil }
            actionError = error.localizedDescription
        }
        return nil
    }

    func react(to message: Message, in threadId: String, emoji: String) async {
        let requestGeneration = runtimeGeneration
        guard let client else { return }
        do {
            let patched = try currentResult(try await client.toggleReaction(threadId: threadId, messageId: message.id, emoji: emoji), using: client, generation: requestGeneration)
            state.apply(.messagePatch(threadId: threadId, message: patched))
        } catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription } }
    }

    func edit(_ message: Message, for bot: Bot, text: String) async {
        await perform { try await $0.edit(botId: bot.id, messageId: message.id, text: text, threadId: bot.threadId) }
    }

    func switchVersion(to message: Message, for bot: Bot) async {
        let requestGeneration = runtimeGeneration
        guard let client else { return }
        do {
            let leaf = try currentResult(try await client.setActiveBranch(botId: bot.id, messageId: message.id, threadId: bot.threadId), using: client, generation: requestGeneration)
            state.apply(.thread(threadId: bot.threadId, activeLeafId: leaf))
        } catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription } }
    }

    func export(threadId: String, format: String) async -> URL? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        do {
            let exported = try currentResult(try await client.export(threadId: threadId, format: format), using: client, generation: requestGeneration)
            let name = URL(fileURLWithPath: exported.filename).lastPathComponent
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
            try exported.data.write(to: url, options: .atomic)
            return url
        } catch {
            if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }
            return nil
        }
    }


    func loadConnectorCatalog() async -> ConnectorCatalog? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        do { return try currentResult(try await client.connectorCatalog(), using: client, generation: requestGeneration) }
        catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }; return nil }
    }

    func loadAllConnectorStatuses() async -> ConnectorStatuses? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        do { return try currentResult(try await client.allConnectorStatuses(), using: client, generation: requestGeneration) }
        catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }; return nil }
    }

    func authorizeConnector(_ slug: String, alias: String?) async -> URL? {
        let requestGeneration = runtimeGeneration
        guard let client else { return nil }
        do { return try currentResult(try await client.authorizeConnector(slug: slug, alias: alias), using: client, generation: requestGeneration) }
        catch { if isCurrent(client, generation: requestGeneration) { actionError = error.localizedDescription }; return nil }
    }

    func refreshNotificationAuthorization() async {
        notificationAuthorization = await NotificationCoordinator.shared.authorizationStatus()
        notificationAuthorizationResolved = true
    }

    func enableNotifications() async {
        if notificationAuthorization == .denied {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                await UIApplication.shared.open(url)
            }
            return
        }
        _ = await NotificationCoordinator.shared.requestAuthorization()
        await refreshNotificationAuthorization()
        NotificationCoordinator.shared.setBadge(state.unreadCount)
    }

    var notificationStatusText: String {
        switch notificationAuthorization {
        case .authorized: return "On"
        case .provisional: return "Quietly on"
        case .ephemeral: return "Temporarily on"
        case .denied: return "Off in Settings"
        case .notDetermined: return "Not enabled"
        @unknown default: return "Unknown"
        }
    }

    private func perform(quietly: Bool = false, _ body: (CompanionClient) async throws -> Void) async {
        guard let client else { return }
        let generation = runtimeGeneration
        do {
            try await body(client)
        } catch is CancellationError {
            return
        } catch let error as APIError where error.isUnauthorized {
            guard isCurrent(client, generation: generation) else { return }
            status = .unauthorized
        } catch {
            guard isCurrent(client, generation: generation) else { return }
            if !quietly { actionError = error.localizedDescription }
        }
    }

    private func currentResult<Value>(_ value: Value, using client: CompanionClient, generation: Int) throws -> Value {
        try requireCurrent(client, generation: generation)
        return value
    }

    private func isCurrent(_ client: CompanionClient, generation: Int) -> Bool {
        !Task.isCancelled && runtimeGeneration == generation && self.client?.connection.id == client.connection.id
    }

    private func requireCurrent(_ client: CompanionClient, generation: Int) throws {
        guard isCurrent(client, generation: generation) else { throw CancellationError() }
    }
}

enum Chat: Identifiable, Hashable {
    case bot(Bot)
    case room(Room)

    var id: String {
        switch self {
        case let .bot(bot): return bot.id
        case let .room(room): return room.id
        }
    }

    var conversationID: String {
        switch self {
        case let .bot(bot): return "bot:\(bot.id):\(bot.threadId)"
        case let .room(room): return "room:\(room.id):\(room.threadId)"
        }
    }

    static func == (left: Chat, right: Chat) -> Bool {
        switch (left, right) {
        case let (.bot(a), .bot(b)): return a.id == b.id && a.threadId == b.threadId
        case let (.room(a), .room(b)): return a.id == b.id && a.threadId == b.threadId
        default: return false
        }
    }

    func hash(into hasher: inout Hasher) {
        switch self {
        case let .bot(bot):
            hasher.combine(0)
            hasher.combine(bot.id)
            hasher.combine(bot.threadId)
        case let .room(room):
            hasher.combine(1)
            hasher.combine(room.id)
            hasher.combine(room.threadId)
        }
    }

    func projected(in state: CompanionState, forThread threadId: String) -> Chat? {
        switch self {
        case let .bot(bot):
            guard let view = state.bot(bot.id)?.projected(forThread: threadId) else { return nil }
            return .bot(view)
        case let .room(room):
            guard let view = state.rooms.first(where: { $0.id == room.id })?.projected(forThread: threadId) else { return nil }
            return .room(view)
        }
    }

    var threadId: String {
        switch self {
        case let .bot(bot): return bot.threadId
        case let .room(room): return room.threadId
        }
    }

    var name: String {
        switch self {
        case let .bot(bot): return bot.name
        case let .room(room): return room.name
        }
    }

    var threadTitle: String {
        switch self {
        case let .bot(bot): return bot.tasks?.first { $0.threadId == bot.threadId }?.displayTitle ?? "Untitled thread"
        case let .room(room): return room.tasks?.first { $0.threadId == room.threadId }?.displayTitle ?? "Conversation"
        }
    }

    var isBot: Bool {
        if case .bot = self { return true }
        return false
    }

    var supportsTasks: Bool {
        switch self {
        case .bot: return true
        case let .room(room): return room.dm != true && room.tasks != nil
        }
    }

    var subtitle: String {
        switch self {
        case let .bot(bot): return bot.title
        case let .room(room): return "\(room.memberIds.count) bots"
        }
    }

    var unread: Bool {
        switch self {
        case let .bot(bot): return bot.unread
        case let .room(room): return room.unread
        }
    }

    var busy: Bool {
        switch self {
        case let .bot(bot): return bot.busy ?? false
        case let .room(room): return room.busyBotId != nil
        }
    }

    var color: String {
        switch self {
        case let .bot(bot): return bot.color
        case .room: return "blue"
        }
    }
}

struct ChatSummary: Identifiable, Hashable {
    let chat: Chat
    let preview: String
    let lastActivity: Double
    let pinned: Bool

    var id: String { chat.id }
}

extension CompanionState {
    func chatSummaries(activity: ActivityDetail = .full) -> [ChatSummary] {
        let bots = self.bots.filter { $0.hidden != true }.map(Chat.bot)
        let rooms = self.rooms.map(Chat.room)
        return (bots + rooms)
            .map { chat in
                let messages = visibleTranscript(forThread: chat.threadId)
                return ChatSummary(
                    chat: chat,
                    preview: rosterPreview(messages, detail: activity),
                    lastActivity: messages.last?.at ?? 0,
                    pinned: Self.pinned(chat)
                )
            }
            .sorted { left, right in
                if left.pinned != right.pinned { return left.pinned }
                if left.chat.unread != right.chat.unread { return left.chat.unread }
                return left.lastActivity > right.lastActivity
            }
    }

    private static func pinned(_ chat: Chat) -> Bool {
        if case let .bot(bot) = chat { return bot.pinned ?? false }
        return false
    }

}
