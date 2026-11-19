// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.core

import java.net.URI
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient


class Session(
    private val scope: CoroutineScope,
    private val connectionStore: ConnectionStore,
    private val tokenStore: TokenStore,
    private val onboardingStore: OnboardingStore,
    private val deviceNameProvider: () -> String,
    private val notificationSink: NotificationSink = NoOpNotificationSink,
    private val httpClient: OkHttpClient = OkHttpClient(),
    private val clientFactory: (Connection, String?) -> CompanionClient = { connection, token ->
        CompanionClient(connection, token, httpClient)
    },
    private val pairFn: suspend (Connection, String, String, String) -> PairingOutcome =
        { connection, credential, deviceName, pairRequestId ->
            CompanionClient.pairFirstReachable(
                connection = connection,
                credential = credential,
                deviceName = deviceName,
                pairRequestId = pairRequestId,
                client = httpClient,
            )
        },
    private val eventsFn: (CompanionClient, String?, Boolean) -> Flow<StreamFrame> = { client, since, screens ->
        client.events(since, screens)
    },
    private val hydrateFn: suspend (CompanionClient, Int?) -> Fleet = { client, messages ->
        client.fleet(messages)
    },
    private val instancesFn: suspend (CompanionClient) -> List<Instance> = { client ->
        client.instances()
    },
    /** Test seam: override the authenticated endpoint snapshot. */
    private val metadataFn: suspend (CompanionClient) -> CompanionConnectionMetadata = { client ->
        client.connectionMetadata()
    },
    private val afterAttachmentDownload: suspend () -> Unit = {},
) {
    sealed interface Status {
        data object Unpaired : Status
        data object Connecting : Status
        data object Live : Status
        data object Unauthorized : Status
        data class Offline(val message: String) : Status
    }

    sealed interface RestoreState {
        data object Pending : RestoreState
        data object Ready : RestoreState
        data object Unpaired : RestoreState
    }

    private val _state = MutableStateFlow(CompanionState())
    val state: StateFlow<CompanionState> = _state.asStateFlow()

    private val _steeringInstanceIds = MutableStateFlow<Set<String>>(emptySet())
    val steeringInstanceIds: StateFlow<Set<String>> = _steeringInstanceIds.asStateFlow()

    private val _connection = MutableStateFlow<Connection?>(null)
    val connection: StateFlow<Connection?> = _connection.asStateFlow()

    private val _connections = MutableStateFlow<List<Connection>>(emptyList())
    val connections: StateFlow<List<Connection>> = _connections.asStateFlow()

    private val _status = MutableStateFlow<Status>(Status.Unpaired)
    val status: StateFlow<Status> = _status.asStateFlow()

    private val _restoreState = MutableStateFlow<RestoreState>(RestoreState.Pending)
    val restoreState: StateFlow<RestoreState> = _restoreState.asStateFlow()

    private val _actionError = MutableStateFlow<String?>(null)
    var actionError: String?
        get() = _actionError.value
        set(value) { _actionError.value = value }
    val actionErrorFlow: StateFlow<String?> = _actionError.asStateFlow()

    private val _focusedMessageId = MutableStateFlow<String?>(null)
    val focusedMessageId: StateFlow<String?> = _focusedMessageId.asStateFlow()

    private val _pairingInvite = MutableStateFlow<PairingInvite?>(null)
    val pairingInvite: StateFlow<PairingInvite?> = _pairingInvite.asStateFlow()

    private val _pairingRequested = MutableStateFlow(false)
    val pairingRequested: StateFlow<Boolean> = _pairingRequested.asStateFlow()

    private var registry = ConnectionRegistry()
    private var client: CompanionClient? = null
    private var token: String? = null
    private var rotation = CandidateRotation(emptyList())
    private var streamJob: Job? = null
    private var endpointRefreshJob: Job? = null
    private var streamGeneration = 0
    private var reconnectDelaySeconds: Long = 0
    private var screenWatchers = 0
    private val gate = Mutex()
    private val notificationGate = Mutex()
    private val attachmentDownloads = AttachmentDownloadCache(scope)
    private val restored = CompletableDeferred<Unit>()
    /** QR credentials authoritatively rejected or redeemed — never start a new request (§6). */
    private val spentQrCredentials = mutableSetOf<String>()

    private val inviteLock = Any()
    private var pairingInFlight = false
    private var deferredInvite: PairingInvite? = null

    init {
        scope.launch {
            try {
                restore()
            } finally {
                restored.complete(Unit)
            }
        }
    }

    suspend fun awaitRestored() {
        restored.await()
    }

    /** Rebuild the last connection at launch — three outcomes match iOS Keychain restore. */
    private suspend fun restore() = gate.withLock {
        restoreLocked()
    }

    /**
     * Redeem a one-time pairing credential. Persists only the long-lived device
     * token + connection — never the QR credential/code.
     *
     * A paired phone may add another computer. The active runtime is only
     * replaced after the new credential has committed; another [pair] still
     * cannot overlap this redeem+persist critical section.
     *
     * A route failure is retryable with the same in-memory request id because
     * it is either preflight-only or an ambiguous replay of the same logical
     * redemption. An authoritative response, or receiving the durable token,
     * burns a high-entropy QR before any local save. Six-digit codes remain
     * retryable for compatibility with manual pairing.
     *
     * This is also the one active attempt: from the moment it is marked in
     * flight until [settlePairingAttempt], a deep link waits in memory rather
     * than replacing the credential being redeemed.
     */
    suspend fun pair(
        connection: Connection,
        credential: String,
        pairRequestId: String = UUID.randomUUID().toString(),
    ) {
        awaitRestored()
        gate.withLock {
            if (pairingInFlight) throw PairingInProgressException()
            if (PairingInvite.normalizedServerCode(credential) != null) connection.requireServerTransport()
            if (isQrCredential(credential) && credential in spentQrCredentials) {
                _actionError.value = SPENT_QR_MESSAGE
                clearInviteIfCredential(credential)
                throw SpentPairingCredentialException()
            }

            // From here this is *the* active attempt. A deep link that arrives
            // now waits in memory instead of taking over the credential slot.
            synchronized(inviteLock) { pairingInFlight = true }
            try {
                val qr = isQrCredential(credential)
                val deviceName = deviceNameProvider()
                val invited = if (connection.allowedRouteKinds == null) {
                    connection.establishingRoutePolicyFromInvite()
                } else {
                    connection
                }
                val (pairedConnection, pairedToken) = try {
                    redeemPairing(invited, credential, deviceName, pairRequestId)
                } catch (error: Throwable) {
                    if (error is kotlinx.coroutines.CancellationException) throw error
                    val routeFailure = error is PairingRouteError || error is ServerPairingRetryError
                    if (qr && !routeFailure) burnQrCredential(credential)
                    _actionError.value = if (qr && !routeFailure) qrFailureMessage(error) else error.message
                    throw error
                }
                if (qr) burnQrCredential(credential)
                var stored = pairedConnection
                val winner = stored.activeEndpoint
                    ?: CompanionEndpoint.direct(stored.host, stored.port, priority = 10_000)
                registry.matchingConnection(stored)?.let { existing -> stored = stored.copy(id = existing.id) }
                val firstPairing = registry.connections.isEmpty()
                val updatedRegistry = registry.upsert(stored)

                try {
                    tokenStore.save(stored.id, pairedToken)
                    PairingCommitSequence.persist(
                        markNotificationOnboardingPending = {
                            if (firstPairing) onboardingStore.setNotificationOnboardingPending(true)
                        },
                        saveConnection = { connectionStore.saveRegistry(updatedRegistry) },
                    )
                } catch (error: Throwable) {
                    if (error is kotlinx.coroutines.CancellationException) throw error
                    _actionError.value = if (qr) qrFailureMessage(error) else error.message
                    throw error
                }

                stopActiveRuntimeLocked()
                registry = updatedRegistry
                _connections.value = registry.connections
                _connection.value = stored
                token = pairedToken
                // The route that just redeemed leads this session; later launches return to the
                // desktop's security-prioritized typed order.
                rotation = CandidateRotation(liveRoutes(stored, winner))
                client = clientFactory(stored, pairedToken)
                _state.value = CompanionState()
                _restoreState.value = RestoreState.Ready
                _pairingRequested.value = false
            } finally {
                settlePairingAttempt()
            }
        }
        connect()
    }

    private suspend fun redeemPairing(
        invited: Connection,
        credential: String,
        deviceName: String,
        requestId: String,
    ): Pair<Connection, String> {
        val serverCode = PairingInvite.normalizedServerCode(credential)
        if (serverCode != null) {
            val descriptor: ServerEnvironment
            val paired: ServerPairResponse
            try {
                descriptor = CompanionClient(invited, null, httpClient).environment()
                paired = CompanionClient.pairWithServer(invited, serverCode, deviceName, requestId, httpClient)
            } catch (error: java.io.IOException) {
                if (error is APIError.Status && error.code < 500 && error.code != 429) throw error
                throw ServerPairingRetryError(error)
            }
            check(paired.environment.environmentId == descriptor.environmentId) {
                "The server changed while pairing. Scan a new code and try again."
            }
            return invited.copy(
                name = paired.environment.label.ifEmpty { invited.name },
                serverEnvironmentId = paired.environment.environmentId,
                serverScopes = paired.session.scopes,
            ) to paired.token
        }
        val outcome = pairFn(invited, credential, deviceName, requestId)
        val paired = outcome.response
        var stored = outcome.connection.copy(
            allowedRouteKinds = invited.allowedRouteKinds,
            allowedLocalRouteURLs = invited.allowedLocalRouteURLs,
        )
        if (paired.serverName.isNotEmpty()) stored = stored.copy(name = paired.serverName)
        stored = stored.applyingPairingAdvertisement(paired.hosts, paired.endpoints)
        val winner = outcome.connection.activeEndpoint
            ?: CompanionEndpoint.direct(outcome.connection.host, outcome.connection.port, priority = 10_000)
        stored = winner?.let(stored::promoting) ?: stored.promoting(stored.host)
        return stored to paired.token
    }

    suspend fun pair(
        invite: PairingInvite,
        pairRequestId: String = UUID.randomUUID().toString(),
    ) = pair(invite.connection, invite.credential, pairRequestId)

    fun receivePairingURL(url: String) {
        if (restored.isCompleted) {
            acceptPairingURL(url)
            return
        }
        scope.launch {
            restored.await()
            acceptPairingURL(url)
        }
    }

    fun receivePairingURI(uri: URI) = receivePairingURL(uri.toString())

    fun consumePairingInvite() = synchronized(inviteLock) {
        _pairingInvite.value = null
    }

    fun beginPairing() {
        _pairingRequested.value = true
    }

    fun endPairing() {
        _pairingRequested.value = false
        consumePairingInvite()
    }

    private fun acceptPairingURL(url: String) {
        synchronized(inviteLock) {
            val invite = PairingInvite.parse(url)
            if (invite == null) {
                _actionError.value =
                    "That pairing invitation is not valid. Start pairing again on your computer."
                return
            }
            if (isQrCredential(invite.credential) && invite.credential in spentQrCredentials) {
                _actionError.value = SPENT_QR_MESSAGE
                return
            }
            // An attempt already in flight owns the screen and the credential
            // slot. This invite waits in memory until that attempt settles;
            // publishing it now would let the finishing attempt erase a
            // credential it never redeemed, and the user would be sent back to
            // the computer for a third QR code (§6).
            if (pairingInFlight) {
                deferredInvite = invite
                return
            }
            _pairingInvite.value = invite
            _pairingRequested.value = true
        }
    }

    // A successfully redeemed one-time pairing credential cannot be offered again.
    private fun settlePairingAttempt() {
        synchronized(inviteLock) {
            pairingInFlight = false
            val waiting = deferredInvite
            deferredInvite = null
            if (_pairingRequested.value.not()) {
                _pairingInvite.value = null
                return
            }
            val invite = waiting ?: return
            if (isQrCredential(invite.credential) && invite.credential in spentQrCredentials) return
            _pairingInvite.value = invite
        }
    }

    private fun markRestoreInconclusive(error: Throwable) {
        _restoreState.value = RestoreState.Pending
        _status.value = Status.Offline(storeFailureMessage(error))
    }

    private fun storeFailureMessage(error: Throwable): String =
        error.message?.takeIf { it.isNotBlank() } ?: STORAGE_UNAVAILABLE_MESSAGE

    private fun burnQrCredential(credential: String) = synchronized(inviteLock) {
        spentQrCredentials += credential
        clearInviteIfCredential(credential)
    }

    private fun clearInviteIfCredential(credential: String) = synchronized(inviteLock) {
        val current = _pairingInvite.value
        if (current?.credential == credential) {
            _pairingInvite.value = null
        }
    }

    private fun qrFailureMessage(error: Throwable): String {
        val base = error.message?.takeIf { it.isNotBlank() } ?: "Pairing failed."
        return "$base Start pairing again on your computer and rescan the new QR code."
    }

    fun signOut() {
        attachmentSendIds.clear()
        streamJob?.cancel()
        streamJob = null
        scope.launch {
            gate.withLock { unpairLocked() }
            connect()
        }
    }

    suspend fun signOutAndAwait() {
        streamJob?.cancel()
        streamJob = null
        gate.withLock { unpairLocked() }
        connect()
    }

    private suspend fun unpairLocked() {
        val id = _connection.value?.id ?: registry.activeConnectionId
        stopActiveRuntimeLocked()
        if (id != null) tokenStore.remove(id)
        registry = id?.let(registry::remove) ?: ConnectionRegistry()
        _connections.value = registry.connections
        connectionStore.saveRegistry(registry)
        if (registry.connections.isEmpty()) {
            onboardingStore.setNotificationOnboardingPending(false)
        }
        _connection.value = null
        _status.value = Status.Unpaired
        _restoreState.value = RestoreState.Unpaired
        restoreSelectedConnectionLocked()
        emptyInviteQueue()
        if (id == null) {
            _pairingRequested.value = false
        }
    }

    // A runtime cannot switch to a computer whose credential is unreadable.
    fun switchComputer(id: String) {
        scope.launch {
            awaitRestored()
            gate.withLock {
                val saved = registry.connection(id) ?: return@withLock
                if (_connection.value?.id == id) {
                    restartStreamLocked()
                    return@withLock
                }
                when (val stored = tokenStore.read(id)) {
                    is TokenStore.ReadResult.Found -> {
                        stopActiveRuntimeLocked()
                        registry = registry.select(id) ?: registry
                        _connections.value = registry.connections
                        connectionStore.saveRegistry(registry)
                        configureActiveConnectionLocked(saved, stored.token)
                    }
                    is TokenStore.ReadResult.Unavailable -> {
                        _actionError.value = if (stored.locked) {
                            "Unlock this phone, then try switching computers again."
                        } else {
                            stored.message
                        }
                    }
                    TokenStore.ReadResult.Missing -> {
                        _actionError.value =
                            "This saved connection is no longer available on this phone. Remove it and pair again."
                    }
                }
            }
            connect()
        }
    }

    fun forgetConnection(id: String) {
        scope.launch {
            awaitRestored()
            gate.withLock {
                if (registry.connection(id) == null) return@withLock
                val wasActive = registry.activeConnectionId == id
                if (wasActive) stopActiveRuntimeLocked()
                tokenStore.remove(id)
                registry = registry.remove(id)
                _connections.value = registry.connections
                connectionStore.saveRegistry(registry)
                if (registry.connections.isEmpty()) onboardingStore.setNotificationOnboardingPending(false)
                if (wasActive) {
                    _connection.value = null
                    _status.value = Status.Unpaired
                    _restoreState.value = RestoreState.Unpaired
                    restoreSelectedConnectionLocked()
                }
            }
            connect()
        }
    }

    private fun stopActiveRuntimeLocked() {
        attachmentDownloads.clear()
        streamGeneration += 1
        streamJob?.cancel()
        streamJob = null
        endpointRefreshJob?.cancel()
        endpointRefreshJob = null
        reconnectDelaySeconds = 0
        screenWatchers = 0
        client = null
        token = null
        rotation = CandidateRotation(emptyList())
        _state.value = CompanionState()
        notificationSink.setBadge(0)
    }


    private fun emptyInviteQueue() = synchronized(inviteLock) {
        _pairingInvite.value = null
    }

    fun connect() {
        scope.launch {
            restored.await()
            gate.withLock {
                if (client == null && _restoreState.value is RestoreState.Pending) {
                    restoreLocked()
                }
                if (client == null || streamJob != null) return@withLock
                reconnectDelaySeconds = 0
                streamGeneration += 1
                val generation = streamGeneration
                streamJob = scope.launch {
                    try {
                        runStream()
                    } finally {
                        gate.withLock {
                            if (streamGeneration == generation) {
                                streamJob = null
                            }
                        }
                    }
                }
            }
        }
    }

    // A failed credential-store read is inconclusive and must not discard an existing pairing.
    private suspend fun restoreLocked() {
        try {
            restoreFromStoresLocked()
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (error: Exception) {
            markRestoreInconclusive(error)
        }
    }

    private suspend fun restoreFromStoresLocked() {
        val restoredRegistry = connectionStore.loadRegistry()
        registry = restoredRegistry.registry.normalized()
        _connections.value = registry.connections
        if (restoredRegistry.migratedLegacyConnection) {
            try {
                connectionStore.saveRegistry(registry)
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (_: Exception) {
            }
        }
        restoreSelectedConnectionLocked()
    }

    // An unreadable credential must not be treated as an absent credential.
    private suspend fun restoreSelectedConnectionLocked() {
        while (true) {
            val saved = registry.activeConnection
            if (saved == null) {
                _connection.value = null
                _restoreState.value = RestoreState.Unpaired
                _status.value = Status.Unpaired
                return
            }
            val stored = try {
                tokenStore.read(saved.id)
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (error: Exception) {
                TokenStore.ReadResult.Unavailable(locked = false, message = storeFailureMessage(error))
            }
            when (stored) {
                is TokenStore.ReadResult.Unavailable -> {
                    _connection.value = saved
                    _restoreState.value = RestoreState.Pending
                    _status.value = Status.Offline(
                        if (stored.locked) "Unlock this phone to reach your computer." else stored.message,
                    )
                    return
                }
                TokenStore.ReadResult.Missing -> {
                    registry = registry.remove(saved.id)
                    _connections.value = registry.connections
                    connectionStore.saveRegistry(registry)
                }
                is TokenStore.ReadResult.Found -> {
                    configureActiveConnectionLocked(saved, stored.token)
                    return
                }
            }
        }
    }

    private fun configureActiveConnectionLocked(saved: Connection, storedToken: String) {
        _connection.value = saved
        token = storedToken
        // A restored pairing walks the desktop's advertised priority, and it walks
        // it credential-safely: a connection already on a protected route never
        // reaches for a local one. Surviving a failover is not a promotion — the
        // computer still decides which protected route leads.
        rotation = CandidateRotation(saved.orderedEndpoints)
        val first = rotation.currentEndpoint?.let(saved::dialing) ?: saved
        client = clientFactory(first, storedToken)
        _restoreState.value = RestoreState.Ready
        _status.value = Status.Connecting
    }

    private suspend fun persistActiveConnectionLocked(updated: Connection) {
        registry = registry.upsert(updated, makeActive = false)
        _connections.value = registry.connections
        _connection.value = updated
        connectionStore.saveRegistry(registry)
    }

    suspend fun refresh() = refresh(null)

    private suspend fun refresh(origin: CompanionClient?) {
        awaitRestored()
        gate.withLock {
            if (origin != null && client !== origin) return
            if (client == null && _restoreState.value is RestoreState.Pending) {
                restoreLocked()
            }
            if (client == null) return@withLock
            streamJob?.cancel()
            streamJob = null
            reconnectDelaySeconds = 0
            streamGeneration += 1
            val generation = streamGeneration
            _status.value = Status.Connecting
            val job = scope.launch {
                try {
                    runStream()
                } finally {
                    gate.withLock {
                        if (streamGeneration == generation) {
                            streamJob = null
                        }
                    }
                }
            }
            streamJob = job
        }
        withTimeoutOrNull(10_000) {
            while (_status.value is Status.Connecting && currentCoroutineContext().isActive) {
                delay(120)
            }
        }
    }

    fun watchScreen(ofBotId: String) {
        scope.launch {
            gate.withLock {
                screenWatchers += 1
                if (screenWatchers == 1) restartStreamLocked()
            }
        }
    }

    fun stopWatchingScreen(ofBotId: String) {
        scope.launch {
            gate.withLock {
                screenWatchers = maxOf(0, screenWatchers - 1)
                if (screenWatchers == 0) {
                    _state.update { it.clearScreen(ofBotId) }
                    restartStreamLocked()
                }
            }
        }
    }

    private fun restartStream() {
        scope.launch {
            gate.withLock { restartStreamLocked() }
        }
    }

    private fun restartStreamLocked() {
        if (streamJob == null) return
        streamJob?.cancel()
        streamJob = null
        if (client == null) return
        reconnectDelaySeconds = 0
        streamGeneration += 1
        val generation = streamGeneration
        val job = scope.launch {
            try {
                runStream()
            } finally {
                gate.withLock {
                    if (streamGeneration == generation) {
                        streamJob = null
                    }
                }
            }
        }
        streamJob = job
    }

    fun disconnect() {
        streamJob?.cancel()
        streamJob = null
        endpointRefreshJob?.cancel()
        endpointRefreshJob = null
    }

    private suspend fun runStream() {
        while (currentCoroutineContext().isActive) {
            val activeClient = client ?: return
            _status.value = Status.Connecting
            var receivedHello = false
            try {
                activeClient.connection.serverEnvironmentId?.let { expected ->
                    // Fail closed before sending the bearer if the address serves a new workspace.
                    if (activeClient.environment().environmentId != expected) {
                        _status.value = Status.Unauthorized
                        return
                    }
                }
                eventsFn(activeClient, _state.value.cursor, screenWatchers > 0)
                    .collect { frame ->
                        currentCoroutineContext().ensureActive()
                        reconnectDelaySeconds = 0

                        when (val payload = frame.frame) {
                            is Frame.Hello -> {
                                receivedHello = true
                                if (!payload.resumed) {
                                    hydrate(payload.cursor)
                                }
                                _status.value = Status.Live
                                promoteWorkingRoute()
                                refreshConnectionMetadata(activeClient)
                            }
                            else -> {
                                _state.update { it.apply(frame) }
                                if (payload is Frame.Notify) {
                                    notificationSink.deliver(payload.notification, frame.seq, activeClient.connection.id)
                                }
                                notificationSink.setBadge(_state.value.unreadCount)
                                _state.update { it.advance(frame.seq) }
                            }
                        }
                    }
                if (!receivedHello) throw MissingStreamHelloException()
                _status.value = Status.Offline("Lost the connection.")
            } catch (error: Throwable) {
                if (!currentCoroutineContext().isActive || error is kotlinx.coroutines.CancellationException) {
                    return
                }
                val apiError = error as? APIError
                if (apiError?.isUnauthorized == true) {
                    _status.value = Status.Unauthorized
                    return
                }
                _status.value = Status.Offline(failureMessage(error))
            }

            if (!currentCoroutineContext().isActive) return
            reconnectDelaySeconds = if (reconnectDelaySeconds == 0L) 1L else minOf(reconnectDelaySeconds * 2, 15L)
            delay(reconnectDelaySeconds * 1_000)
        }
    }

    private suspend fun hydrate(cursor: String) {
        val activeClient = client ?: return
        val fleet = hydrateFn(activeClient, 50)
        val waiting = mutableMapOf<String, ThreadPage>()
        val owners = fleet.bots.map { it.threadId to it.tasks.orEmpty() } + fleet.groups.map { it.threadId to it.tasks.orEmpty() }
        for ((selected, tasks) in owners) for (task in tasks) {
            if (task.threadId != selected && task.activity == "waiting-on-you" && task.threadId !in waiting) {
                currentCoroutineContext().ensureActive()
                waiting[task.threadId] = activeClient.messages(task.threadId, limit = 50)
            }
        }
        currentCoroutineContext().ensureActive()
        gate.withLock {
            if (client !== activeClient) throw CancellationException("The originating computer changed")
            _state.update { it.hydrate(fleet, waiting).resetCursor(cursor) }
            notificationSink.setBadge(_state.value.unreadCount)
        }
        scope.launch {
            _steeringInstanceIds.value = try {
                instancesFn(activeClient)
                    .filter { it.capabilities?.queueing == true }
                    .map { it.instanceId }
                    .toSet()
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                emptySet()
            }
        }
    }

    private suspend fun failureMessage(error: Throwable): String {
        val moved = gate.withLock { advanceRouteLocked(error) }
            ?: return error.message?.takeIf { it.isNotBlank() } ?: "Could not reach the computer."
        ConnectionAdvice.gatewayStatus(error)?.let { status ->
            return ConnectionAdvice.message(status, moved.failedAddress, moved.next)
        }
        val failure = ConnectionAdvice.classify(error)
        return if (failure == ConnectionFailure.OTHER) {
            error.message?.takeIf { it.isNotBlank() }
                ?: ConnectionAdvice.message(failure, moved.failedAddress, moved.failedPort, moved.next)
        } else {
            ConnectionAdvice.message(failure, moved.failedAddress, moved.failedPort, moved.next)
        }
    }

    private fun advanceRouteLocked(error: Throwable): RouteMove? {
        val connection = _connection.value ?: return null
        val failed = rotation.currentEndpoint
            ?: connection.activeEndpoint
            ?: CompanionEndpoint.direct(connection.host, connection.port, priority = 10_000)
        var next: String? = null
        val candidate = rotation.advanceEndpoint(error)
        val activeToken = token
        if (candidate != null && activeToken != null) {
            client = clientFactory(connection.dialing(candidate), activeToken)
            next = candidate.displayAddress
        }
        return RouteMove(
            failedAddress = failed?.displayAddress ?: connection.host,
            failedPort = failed?.port ?: connection.port,
            next = next,
        )
    }

    private data class RouteMove(
        val failedAddress: String,
        val failedPort: Int,
        val next: String?,
    )

    private suspend fun promoteWorkingRoute() = gate.withLock {
        val winner = rotation.currentEndpoint ?: return@withLock
        val updated = _connection.value ?: return@withLock
        if (updated.activeEndpoint?.url == winner.url) return@withLock
        val promoted = updated.promoting(winner)
        persistActiveConnectionLocked(promoted)
    }

    /**
     * Learn routes the computer enabled after this phone paired. The snapshot is authenticated
     * with the device token already in hand and carries no account or pairing credential, so an
     * already-paired phone can discover hosted HTTPS without another QR code.
     *
     * Failure is deliberately non-fatal: an older sidecar answers 404 and a transient refresh
     * error must not tear down a healthy event stream.
     *
     * The live route is not swapped underneath the stream either, and that is worth being exact
     * about: the replacement order takes effect **on the next launch and on the next route
     * change** — not on every reconnect. [runStream] re-reads `client` each lap but nothing here
     * rebuilds it, so a stream that simply ends and reopens comes back on the same authority it
     * was already using. That is deliberate. The live route is at the head of the walk precisely
     * because the advertised head just failed; re-preferring it after every clean reconnect would
     * pay that failure's timeout again and again, and would move a working session onto another
     * authority for no reason. A route change — a real failure that advances the walk — reads the
     * refreshed list, and a launch reads the persisted order, which is where the new policy lands.
     *
     * And it is the computer's order that lands there. This request is how the desktop restates
     * its transport policy, so nothing local may quietly outrank it; if it could, the refresh
     * would be decorative.
     */
    private fun refreshConnectionMetadata(source: CompanionClient) {
        if (source.connection.pairedWithServer) return
        val connectionId = _connection.value?.id ?: return
        val workingEndpoint = rotation.currentEndpoint ?: source.connection.activeEndpoint
        endpointRefreshJob?.cancel()
        endpointRefreshJob = scope.launch {
            try {
                val metadata = metadataFn(source)
                gate.withLock {
                    val current = _connection.value ?: return@withLock
                    if (current.id != connectionId) return@withLock
                    if (client?.connection?.baseUrl != source.connection.baseUrl) return@withLock
                    val updated = current.reconciling(metadata)
                    persistActiveConnectionLocked(updated)
                    rotation = CandidateRotation(liveRoutes(updated, workingEndpoint))
                }
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (error: Exception) {
                return@launch
            }
        }
    }

    private fun liveRoutes(
        connection: Connection,
        winner: CompanionEndpoint?,
    ): List<CompanionEndpoint> {
        val routes = connection.orderedEndpoints
        return if (winner == null) routes else listOf(winner) + routes.filterNot { it.url == winner.url }
    }

    fun updateAddress(text: String): Boolean {
        val parsed = Connection.parse(text) ?: return false
        val current = _connection.value ?: return false
        val endpoint = parsed.activeEndpoint
            ?: CompanionEndpoint.direct(parsed.host, parsed.port, priority = 0)
            ?: return false
        val updated = current.resettingRoutePolicy(endpoint)
        scope.launch {
            gate.withLock {
                persistActiveConnectionLocked(updated)
                rotation = CandidateRotation(liveRoutes(updated, endpoint))
                val activeToken = token
                if (activeToken != null) {
                    client = clientFactory(updated, activeToken)
                }
                restartStreamLocked()
            }
        }
        return true
    }

    suspend fun updateAddressAndAwait(text: String): Boolean {
        val parsed = Connection.parse(text) ?: return false
        val current = _connection.value ?: return false
        val endpoint = parsed.activeEndpoint
            ?: CompanionEndpoint.direct(parsed.host, parsed.port, priority = 0)
            ?: return false
        val updated = current.resettingRoutePolicy(endpoint)
        gate.withLock {
            persistActiveConnectionLocked(updated)
            rotation = CandidateRotation(liveRoutes(updated, endpoint))
            val activeToken = token
            if (activeToken != null) {
                client = clientFactory(updated, activeToken)
            }
            restartStreamLocked()
        }
        return true
    }


    suspend fun send(text: String, to: Chat): Boolean = send(text, emptyList(), to)

    private fun record(receipt: SendReceipt, text: String, fallbackThreadId: String, botQueueRevision: Long?) {
        val queued = receipt as? SendReceipt.Queued ?: return
        val threadId = queued.threadId.ifEmpty { fallbackThreadId }
        _state.update { it.rememberQueued(QueuedSend(queued.queueId, text), threadId, botQueueRevision) }
    }

    suspend fun cancelQueued(send: QueuedSend, chat: Chat): Boolean {
        val activeClient = client ?: return false
        val destination = when (chat) {
            is Chat.BotChat -> MessageDestination.Bot(chat.bot.id, chat.threadId)
            is Chat.RoomChat -> MessageDestination.Room(chat.room.id, chat.threadId)
        }
        try {
            val cancelled = activeClient.cancelQueued(send.queueId, destination)
            if (client !== activeClient) return false
            _state.update { it.forgetQueued(send.queueId, chat.threadId) }
            return cancelled
        } catch (error: CancellationException) {
            throw error
        } catch (error: APIError) {
            if (client !== activeClient) return false
            if (error.isUnauthorized) _status.value = Status.Unauthorized
            _actionError.value = error.message
            return false
        }
    }

    suspend fun updateClaude(instanceId: String): ClaudeUpdateResult {
        val activeClient = client ?: return ClaudeUpdateResult.Failed("This computer is offline.")
        return try {
            ClaudeUpdateResult.Updated(activeClient.updateClaude(instanceId))
        } catch (error: CancellationException) {
            throw error
        } catch (error: APIError) {
            if (error.isUnauthorized) _status.value = Status.Unauthorized
            ClaudeUpdateResult.Failed(error.message ?: "Claude Code could not be updated.")
        }
    }

    private data class AttachmentDraftKey(
        val destination: MessageDestination,
        val text: String,
        val attachmentIds: List<String>,
    )

    private val attachmentSendIds = LinkedHashMap<AttachmentDraftKey, String>()

    suspend fun send(text: String, attachments: List<PendingMessageAttachment>, to: Chat, originConnectionId: String? = _connection.value?.id): Boolean {
        val activeClient = client ?: run {
            _actionError.value = "This computer is offline."
            return false
        }
        val connectionId = _connection.value?.id
        if (originConnectionId == null || connectionId != originConnectionId || activeClient.connection.id != originConnectionId) return false
        _actionError.value = null
        return try {
            AttachmentPolicy.validate(attachments)
            if (text.isBlank() && attachments.isEmpty()) {
                _actionError.value = "Write a message or attach a file first."
                return false
            }
            if (attachments.any { it.kind == PendingMessageAttachment.Kind.IMAGE }) {
                val capable = try {
                    activeClient.imageCapableInstanceIds()
                } catch (error: APIError.Status) {
                    if (error.code != 404) throw error
                    _actionError.value = "Update StartupBot on this computer before sending images."
                    return false
                }
                if (!imageSupported(to, capable)) {
                    _actionError.value = imageCompatibilityMessage(to)
                    return false
                }
            }
            val destination = when (to) {
                is Chat.BotChat -> MessageDestination.Bot(to.bot.id, to.bot.threadId)
                is Chat.RoomChat -> MessageDestination.Room(to.room.id, to.room.threadId)
            }
            val key = AttachmentDraftKey(destination, text, attachments.map { it.id })
            if (attachmentSendIds.size >= 20 && key !in attachmentSendIds) attachmentSendIds.clear()
            val sendId = attachmentSendIds.getOrPut(key) { UUID.randomUUID().toString() }

            val uploaded = attachments.map { attachment ->
                currentCoroutineContext().ensureActive()
                if (client !== activeClient) throw CancellationException("The originating computer changed")
                val mime = AttachmentPolicy.normalizedMime(attachment.mime)
                when (attachment.kind) {
                    PendingMessageAttachment.Kind.IMAGE -> SharedAttachmentReference(
                        path = activeClient.uploadImage(attachment.data, mime, attachment.id),
                        kind = SharedAttachmentKind.IMAGE,
                        displayName = attachment.name,
                    )
                    PendingMessageAttachment.Kind.FILE -> {
                        val file = activeClient.uploadFile(attachment.data, attachment.name, mime, attachment.id)
                        SharedAttachmentReference(file.path, SharedAttachmentKind.FILE, file.name)
                    }
                }
            }
            val message = SharedMessageComposer.compose(
                instruction = text,
                text = emptyList(),
                urls = emptyList(),
                attachments = uploaded,
            )
            if (client !== activeClient) return false
            val queueRevision = if (to is Chat.BotChat) _state.value.botQueueRevision else null
            val receipt = activeClient.send(message, destination, sendId)
            currentCoroutineContext().ensureActive()
            if (client !== activeClient) return false
            gate.withLock {
                if (client !== activeClient) false else {
                    record(receipt, text.trim().ifEmpty { message }, to.threadId, queueRevision)
                    attachmentSendIds.remove(key)
                    _actionError.value = null
                    true
                }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: APIError) {
            if (client !== activeClient) return false
            if (error.isUnauthorized) {
                gate.withLock {
                    if (client === activeClient) {
                        _status.value = Status.Unauthorized
                    }
                }
            }
            _actionError.value = error.message
            false
        } catch (error: Throwable) {
            if (client !== activeClient) return false
            _actionError.value = error.message
            false
        }
    }

    private fun imageSupported(chat: Chat, capableInstances: Set<String>): Boolean = when (chat) {
        is Chat.BotChat -> chat.bot.modelSelection.instanceId in capableInstances
        is Chat.RoomChat -> chat.room.memberIds.isNotEmpty() && chat.room.memberIds.all { id ->
            val bot = _state.value.bot(id) ?: return@all false
            bot.modelSelection.instanceId in capableInstances
        }
    }

    private fun imageCompatibilityMessage(chat: Chat): String = when (chat) {
        is Chat.BotChat ->
            "${chat.bot.name}'s current model doesn't support images. Choose another model or remove the image."
        is Chat.RoomChat ->
            "Every bot that may answer in this channel must use a model that supports images."
    }

    suspend fun downloadFile(
        threadId: String,
        messageId: String,
        path: String,
        reportError: Boolean = true,
        cacheResult: Boolean = false,
    ): DownloadedFile? {
        val activeClient = client ?: run {
            if (reportError) _actionError.value = "This computer is offline."
            return null
        }
        val connectionId = _connection.value?.id
        if (reportError) _actionError.value = null
        return try {
            val id = connectionId ?: throw APIError.Transport("This computer is offline.")
            val download = attachmentDownloads.getOrLoad(
                AttachmentDownloadKey(id, threadId, messageId, path),
                retainResult = cacheResult,
            ) {
                activeClient.downloadFile(threadId, messageId, path)
            }
            afterAttachmentDownload()
            currentCoroutineContext().ensureActive()
            gate.withLock { if (client === activeClient) download else null }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            gate.withLock {
                if (client === activeClient) {
                    if ((error as? APIError)?.isUnauthorized == true) _status.value = Status.Unauthorized
                    if (reportError) _actionError.value = error.message
                }
            }
            null
        }
    }

    suspend fun <T> withShareClient(connectionId: String, action: suspend (CompanionClient) -> T): T {
        val first = client ?: throw IllegalStateException("Connect to the selected computer before sharing.")
        if (_connection.value?.id != connectionId) {
            throw IllegalStateException("The selected computer changed. Choose the destination again.")
        }
        val retry = try {
            acceptCurrent(first) { Unit }
            val result = action(first)
            return acceptCurrent(first) { result }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            gate.withLock {
                if (client !== first) throw error
                if ((error as? APIError)?.isUnauthorized == true) _status.value = Status.Unauthorized
                advanceRouteLocked(error)
                client?.takeIf { it !== first } ?: throw error
            }
        }
        acceptCurrent(retry) { Unit }
        val result = action(retry)
        return acceptCurrent(retry) { result }
    }

    /**
     * One share/upload against a saved computer without moving the live stream.
     *
     * The active pairing keeps its HTTPS ratchet via [withShareClient]. A share
     * aimed at another saved computer walks only that computer's credential-
     * approved routes and must not mark this session unauthorized: a 401 there
     * is about that pairing, not the one currently on screen.
     */
    suspend fun <T> withPairedShareClient(
        connectionId: String,
        action: suspend (CompanionClient) -> T,
    ): T {
        awaitRestored()
        if (_connection.value?.id == connectionId) {
            return withShareClient(connectionId, action)
        }
        val saved = registry.connection(connectionId)
            ?: throw APIError.Transport("This saved connection is no longer available on this phone. Remove it and pair again.")
        val pairedToken = when (val stored = tokenStore.read(connectionId)) {
            is TokenStore.ReadResult.Found -> stored.token
            is TokenStore.ReadResult.Unavailable -> throw APIError.Transport(
                if (stored.locked) {
                    "Unlock this phone, then try sharing again."
                } else {
                    stored.message
                },
            )
            TokenStore.ReadResult.Missing -> throw APIError.Transport(
                "This saved connection is no longer available on this phone. Remove it and pair again.",
            )
        }
        val endpoints = saved.automaticEndpoints
        if (endpoints.isEmpty()) {
            throw APIError.Transport(
                "Couldn't reach ${saved.name}. Keep StartupBot open and Phone access on, then try again.",
            )
        }
        var lastError: Throwable? = null
        for (endpoint in endpoints) {
            val candidate = clientFactory(saved.dialing(endpoint), pairedToken)
            try {
                return action(candidate)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                lastError = error
                if (!canRetryShareOnAnotherRoute(error)) throw error
            }
        }
        throw lastError ?: APIError.Transport(
            "Couldn't reach ${saved.name}. Keep StartupBot open and Phone access on, then try again.",
        )
    }

    private fun canRetryShareOnAnotherRoute(error: Throwable): Boolean {
        val api = generateSequence(error) { it.cause }.filterIsInstance<APIError>().firstOrNull()
        return if (api != null) {
            ConnectionAdvice.shouldRetryPairingOnAnotherRoute(api)
        } else {
            ConnectionAdvice.shouldTryAnotherHost(error)
        }
    }

    suspend fun answer(
        chat: Chat,
        card: OptionCard,
        choice: String,
        rememberingPermission: Boolean = true,
    ) = answerWithPermission(chat, card, choice, rememberingPermission && card.shouldRememberPermission(choice))

    suspend fun grantAndAnswer(chat: Chat.BotChat, card: OptionCard, choice: String) =
        answerWithPermission(chat, card, choice, true)

    private suspend fun answerWithPermission(chat: Chat, card: OptionCard, choice: String, remember: Boolean) {
        val requestId = card.requestId ?: return
        val behavior = OptionCard.responseBehavior(choice, card.isPermission)
        perform { activeClient ->
            if (remember && chat is Chat.BotChat && card.isPermission && behavior == "allow") {
                card.allowKey?.let { activeClient.alwaysAllow(chat.bot.id, it, chat.bot.threadId) }
                currentCoroutineContext().ensureActive()
                if (client !== activeClient) return@perform
            }
            if (client !== activeClient) return@perform
            activeClient.respond(
                threadId = chat.threadId,
                requestId = requestId,
                behavior = behavior,
                message = choice.takeIf { behavior == "answer" },
                reviewedSha256 = card.skillRequest?.reviewedSha256.takeIf { behavior == "allow" },
            )
        }
    }

    suspend fun answer(
        threadId: String,
        requestId: String,
        choice: String,
        isPermission: Boolean,
        reviewedSha256: String? = null,
    ) {
        perform {
            val behavior = OptionCard.responseBehavior(choice, isPermission)
            it.respond(
                threadId = threadId,
                requestId = requestId,
                behavior = behavior,
                message = choice.takeIf { behavior == "answer" },
                reviewedSha256 = reviewedSha256.takeIf { behavior == "allow" },
            )
        }
    }

    suspend fun alwaysAllow(bot: Bot, card: OptionCard) {
        val key = card.allowKey ?: return
        perform { it.alwaysAllow(bot.id, key, bot.threadId) }
    }

    suspend fun answerQuestion(threadId: String, card: OptionCard, answer: String): Boolean {
        val activeClient = client ?: return false
        val requestId = card.requestId ?: return false
        if (!card.isPending || card.isPermission || card.questionRequest?.version != 1 || answer.isBlank() || answer.length > 100_000) return false
        val current = gate.withLock {
            if (client !== activeClient) false else { _actionError.value = null; true }
        }
        if (!current) return false
        return try {
            activeClient.respond(threadId = threadId, requestId = requestId, behavior = "answer", message = answer)
            currentCoroutineContext().ensureActive()
            gate.withLock { client === activeClient }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            gate.withLock {
                if (client === activeClient) {
                    if ((error as? APIError)?.isUnauthorized == true) _status.value = Status.Unauthorized
                    _actionError.value = error.message
                }
            }
            false
        }
    }

    suspend fun createBot(): Bot? = requestCurrent(apply = { bot ->
        _state.update { it.apply(Frame.Bot(bot)) }
    }) { it.createBot() }

    suspend fun createRoom(name: String?, memberIds: List<String>): Room? = requestCurrent(apply = { room ->
        _state.update { it.apply(Frame.Room(room)) }
    }) { it.createRoom(name, memberIds) }

    suspend fun assignSection(name: String, botIds: List<String>): List<Bot>? = requestCurrent(apply = { bots ->
        _state.update { state -> bots.fold(state) { current, bot -> current.apply(Frame.Bot(bot)) } }
    }) { it.assignSection(name, botIds) }

    suspend fun interrupt(bot: Bot) {
        perform { it.interrupt(bot.id, bot.threadId) }
    }

    suspend fun cloudDesktop(forBot: Bot): URI {
        val activeClient = client ?: throw APIError.Transport("This computer is offline.")
        return try {
            val result = activeClient.cloudDesktop(forBot.id).url
            acceptCurrent(activeClient) { result }
        } catch (error: APIError) {
            if (error.isUnauthorized) {
                gate.withLock {
                    // Only the live computer's 401 may mark this session revoked.
                    if (client === activeClient) {
                        _status.value = Status.Unauthorized
                    }
                }
            }
            throw error
        }
    }

    suspend fun markRead(chat: Chat) {
        perform(quietly = true) {
            when (chat) {
                is Chat.BotChat -> it.markBotRead(chat.bot.id, chat.threadId)
                is Chat.RoomChat -> it.markRoomRead(chat.room.id, chat.threadId)
            }
        }
    }

    suspend fun loadThread(threadId: String) {
        val revision = _state.value.clearRevisions[threadId]
        requestCurrent(apply = { page -> _state.update { if (it.clearRevisions[threadId] == revision) it.merge(page, threadId) else it } }) {
            it.messages(threadId, limit = 50)
        }
    }

    suspend fun loadThreadIfNeeded(threadId: String) {
        if (!_state.value.hasLoadedPage(threadId)) loadThread(threadId)
    }

    suspend fun loadOlder(threadId: String) {
        val origin = client ?: return
        val oldest = _state.value.transcript(threadId).firstOrNull() ?: return
        val revision = _state.value.clearRevisions[threadId]
        requestCurrent(origin, apply = { page -> _state.update { if (it.clearRevisions[threadId] == revision) it.prepend(page, threadId) else it } }) {
            it.messages(threadId, before = oldest.id, limit = 50)
        }
    }

    suspend fun image(threadId: String, messageId: String): ByteArray? =
        requestCurrent(quietly = true) { it.image(threadId, messageId) }

    suspend fun search(query: String): List<SearchHit> {
        val trimmed = query.trim()
        if (trimmed.length < 2) return emptyList()
        val activeClient = client ?: return emptyList()
        return try {
            val hits = activeClient.search(trimmed)
            gate.withLock { if (client === activeClient) hits else emptyList() }
        } catch (error: Throwable) {
            if (error is CancellationException) throw error
            if (client !== activeClient) return emptyList()
            _actionError.value = error.message
            emptyList()
        }
    }

    suspend fun open(hit: SearchHit): Chat? {
        val activeClient = client ?: return null
        return try {
            val botId = hit.botId
            if (botId != null) {
                if (_state.value.bot(botId)?.forTask(hit.threadId) == null && !refreshNavigationState(activeClient)) return null
                val bot = _state.value.bot(botId)?.forTask(hit.threadId)
                    ?: throw APIError.Status(404, THREAD_GONE_MESSAGE)
                if (!hit.onActivePath) {
                    val leaf = activeClient.setActiveBranch(bot.id, hit.messageId, hit.threadId)
                    gate.withLock {
                        if (client !== activeClient) throw CancellationException("The originating computer changed")
                        _state.update { it.apply(Frame.Thread(hit.threadId, leaf)) }
                    }
                }
                connectSearchHistory(hit, activeClient)
                return gate.withLock {
                    if (client !== activeClient) null else {
                        _focusedMessageId.value = hit.messageId
                        _state.value.chat(ChatTarget.Bot(bot.id, hit.threadId))
                    }
                }
            }
            val groupId = hit.groupId
            if (groupId != null) {
                var room = _state.value.rooms.firstOrNull { it.id == groupId } ?: return null
                if (room.threadId != hit.threadId) {
                    room = activeClient.switchRoomTask(room.id, hit.threadId)
                    gate.withLock {
                        if (client !== activeClient) throw CancellationException("The originating computer changed")
                        _state.update { it.apply(Frame.Room(room)) }
                    }
                }
                connectSearchHistory(hit, activeClient)
                return gate.withLock {
                    if (client !== activeClient) null else {
                        _focusedMessageId.value = hit.messageId
                        _state.value.chat(ChatTarget.Room(groupId, hit.threadId))
                    }
                }
            }
            null
        } catch (error: Throwable) {
            if (client !== activeClient) return null
            if (error is CancellationException) throw error
            _actionError.value = error.message
            null
        }
    }

    private suspend fun connectSearchHistory(hit: SearchHit, activeClient: CompanionClient) {
        val landing = SearchLanding(hit.threadId, hit.messageId)
        val revision = _state.value.clearRevisions[hit.threadId]
        fun mergeSearchPage(page: ThreadPage, leafAtRequest: String?) {
            _state.update {
                if (it.clearRevisions[hit.threadId] != revision) throw CancellationException("The conversation was cleared")
                landing.merge(page, it, leafAtRequest)
            }
        }
        val rendered = gate.withLock {
            if (client !== activeClient) throw CancellationException("The originating computer changed")
            landing.isRendered(_state.value)
        }
        if (rendered) return
        var leafAtRequest = gate.withLock { landing.leaf(_state.value) }
        var page = activeClient.messagesAround(hit.threadId, hit.messageId)
        currentCoroutineContext().ensureActive()
        gate.withLock {
            if (client !== activeClient) throw CancellationException("The originating computer changed")
            mergeSearchPage(page, leafAtRequest)
        }
        while (true) {
            val cursor = gate.withLock {
                if (client !== activeClient) throw CancellationException("The originating computer changed")
                landing.next(_state.value)
            } ?: return
            leafAtRequest = gate.withLock { landing.leaf(_state.value) }
            page = when (cursor) {
                SearchHistoryCursor.Latest -> activeClient.messages(hit.threadId, limit = 200)
                is SearchHistoryCursor.Around -> activeClient.messagesAround(hit.threadId, cursor.messageId, limit = 200)
            }
            currentCoroutineContext().ensureActive()
            gate.withLock {
                if (client !== activeClient) throw CancellationException("The originating computer changed")
                mergeSearchPage(page, leafAtRequest)
            }
        }
    }

    suspend fun openNotification(target: NotificationTarget): Chat? {
        awaitRestored()
        return notificationGate.withLock {
            val activeClient = client
            if (activeClient == null) {
                _actionError.value = "Pair this phone with your computer to open that task."
                return@withLock null
            }

            if (target.connectionId != activeClient.connection.id) {
                _actionError.value = "Select the computer that sent this notification before opening it."
                return@withLock null
            }
            try {
                _state.value.roomOwningTask(target.threadId)?.let { room ->
                    return@withLock openRoomNotification(activeClient, room, target.threadId)
                }

                if (_state.value.bot(target.botId)?.forTask(target.threadId) == null) {
                    if (!refreshNavigationState(activeClient)) return@withLock null
                    _state.value.roomOwningTask(target.threadId)?.let { room ->
                        return@withLock openRoomNotification(activeClient, room, target.threadId)
                    }
                }

                val selected = _state.value.bot(target.botId)
                    ?: throw APIError.Status(404, "That agent no longer exists.")
                Chat.BotChat(selected.forTask(target.threadId)
                    ?: throw APIError.Status(404, THREAD_GONE_MESSAGE))
            } catch (error: Throwable) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                if (client !== activeClient) return@withLock null
                _actionError.value = error.message
                null
            }
        }
    }

    private suspend fun refreshNavigationState(activeClient: CompanionClient): Boolean {
        val before = _state.value
        val fleet = hydrateFn(activeClient, 50)
        currentCoroutineContext().ensureActive()
        return gate.withLock {
            if (client !== activeClient) return@withLock false
            _state.update { current ->
                if (current !== before) current else current.copy(bots = fleet.bots, rooms = fleet.groups)
            }
            notificationSink.setBadge(_state.value.unreadCount)
            true
        }
    }

    private suspend fun openRoomNotification(
        activeClient: CompanionClient,
        room: Room,
        threadId: String,
    ): Chat.RoomChat {
        if (room.threadId == threadId) return Chat.RoomChat(room)
        val switched = activeClient.switchRoomTask(room.id, threadId)
        currentCoroutineContext().ensureActive()
        if (client !== activeClient) throw CancellationException("The active computer changed.")
        _state.update { it.apply(Frame.Room(switched)) }
        return Chat.RoomChat(_state.value.rooms.firstOrNull { it.id == room.id } ?: switched)
    }

    fun consumeFocus(messageId: String) {
        if (_focusedMessageId.value == messageId) _focusedMessageId.value = null
    }

    suspend fun openThread(ref: ThreadRef): Bot? {
        currentCoroutineContext().ensureActive()
        val activeClient = client
        if (activeClient == null) {
            _actionError.value = "Pair this phone with your computer to open that thread."
            return null
        }
        _actionError.value = null
        return try {
            if (_state.value.bot(ref.botId)?.forTask(ref.threadId) == null) {
                if (!refreshNavigationState(activeClient)) return null
            }
            val selected = _state.value.bot(ref.botId)
                ?: throw APIError.Status(404, "That agent no longer exists.")
            selected.forTask(ref.threadId) ?: throw APIError.Status(404, THREAD_GONE_MESSAGE)
        } catch (error: Throwable) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            currentCoroutineContext().ensureActive()
            if (client !== activeClient) return null
            _actionError.value = error.message
            null
        }
    }

    internal suspend fun <T> mutateTask(offline: T, mutation: suspend (CompanionClient) -> T): T =
        requestCurrent(request = mutation) ?: offline

    suspend fun createTask(forBot: Bot, title: String?): Bot? = mutateTask(null) { client ->
        client.createTask(forBot.id, title).also { updated ->
            acceptCurrent(client) { _state.update { it.apply(Frame.Bot(updated)) } }
        }
    }

    suspend fun switchTask(task: BotTask, forBot: Bot): Bot? {
        if (task.threadId == forBot.threadId) return forBot
        return mutateTask(null) { client ->
            val revision = _state.value.clearRevisions[task.threadId]
            client.switchTask(forBot.id, task.threadId).also { updated ->
                acceptCurrent(client) {
                    _state.update {
                        if (it.clearRevisions[task.threadId] != revision) throw CancellationException("The conversation was cleared")
                        it.apply(Frame.Bot(updated))
                    }
                }
            }
        }
    }

    suspend fun renameTask(task: BotTask, forBot: Bot, title: String): Boolean = mutateTask(false) { client ->
        client.renameTask(forBot.id, task.threadId, title)
        refresh(client)
        true
    }

    suspend fun pinTask(task: BotTask, chat: Chat, pinned: Boolean): Boolean = mutateTask(false) { client ->
        when (chat) {
            is Chat.BotChat -> client.setTaskPinned(chat.bot.id, task.threadId, pinned)
            is Chat.RoomChat -> client.setRoomTaskPinned(chat.room.id, task.threadId, pinned, task.title)
        }
        refresh(client)
        true
    }

    suspend fun archiveTask(task: BotTask, forBot: Bot, archivedAt: Double?): Boolean = mutateTask(false) { client ->
        client.setTaskArchived(forBot.id, task.threadId, archivedAt)
        refresh(client)
        true
    }

    suspend fun deleteTask(task: BotTask, forBot: Bot): Bot? = mutateTask(null) { client ->
        client.deleteTask(forBot.id, task.threadId).also { updated ->
            acceptCurrent(client) { _state.update { it.apply(Frame.Bot(updated)) } }
        }
    }

    suspend fun snoozeTask(task: BotTask, forBot: Bot, snoozedUntil: Long?): Boolean = mutateTask(false) { client ->
        client.snoozeTask(forBot.id, task.threadId, snoozedUntil)
        refresh(client)
        true
    }

    suspend fun createTask(forRoom: Room, title: String?): Room? = mutateTask(null) { client ->
        client.createRoomTask(forRoom.id, title).also { updated ->
            acceptCurrent(client) { _state.update { it.apply(Frame.Room(updated)) } }
        }
    }

    suspend fun switchTask(task: BotTask, forRoom: Room): Room? {
        if (task.threadId == forRoom.threadId) return forRoom
        return mutateTask(null) { client ->
            client.switchRoomTask(forRoom.id, task.threadId).also { updated ->
                acceptCurrent(client) { _state.update { it.apply(Frame.Room(updated)) } }
            }
        }
    }

    suspend fun renameTask(task: BotTask, forRoom: Room, title: String): Boolean = mutateTask(false) { client ->
        client.renameRoomTask(forRoom.id, task.threadId, title)
        refresh(client)
        true
    }

    suspend fun deleteTask(task: BotTask, forRoom: Room): Room? = mutateTask(null) { client ->
        client.deleteRoomTask(forRoom.id, task.threadId).also { updated ->
            acceptCurrent(client) { _state.update { it.apply(Frame.Room(updated)) } }
        }
    }

    suspend fun updateProfile(patch: BotProfilePatch, forBot: Bot): Bot? = requestCurrent(apply = { bot ->
        _state.update { it.apply(Frame.Bot(bot)) }
    }) { it.updateProfile(forBot.id, patch) }

    suspend fun modelInstances(): List<Instance> = requestCurrent { it.instances() } ?: emptyList()

    suspend fun updateModel(selection: ModelSelection, forBot: Bot): Bot? = requestCurrent(apply = { bot ->
        _state.update { it.apply(Frame.Bot(bot)) }
    }) { it.updateModel(forBot.id, selection, forBot.threadId) }?.forTask(forBot.threadId)

    suspend fun uploadAvatar(data: ByteArray, mime: String, forBot: Bot, crop: AvatarCrop): Bot? = requestCurrent(apply = { bot ->
        _state.update { it.apply(Frame.Bot(bot)) }
    }) { origin ->
        val avatarUrl = origin.uploadAvatar(data, mime)
        acceptCurrent(origin) { Unit }
        origin.updateProfile(forBot.id, BotProfilePatch(
            avatarUrl = BotProfilePatch.AvatarURL.Set(avatarUrl), avatarCrop = crop,
        ))
    }

    suspend fun generateAvatar(prompt: String, forBot: Bot): Bot? = requestCurrent(apply = { bot ->
        _state.update { it.apply(Frame.Bot(bot)) }
    }) { it.generateAvatar(forBot.id, prompt) }

    suspend fun avatarData(forBot: Bot): ByteArray? {
        val path = forBot.avatarUrl ?: return null
        return requestCurrent(quietly = true) { it.avatar(path) }
    }

    suspend fun voiceOptions(): List<Voice> = requestCurrent { it.voices() } ?: emptyList()

    suspend fun previewVoice(voiceId: String, forBot: Bot): ByteArray? =
        requestCurrent { it.previewVoice("Hello, I'm ${forBot.name}.", voiceId) }

    suspend fun prepareSpeech(text: String, voiceId: String?): PreparedSpeech {
        val activeClient = client ?: throw APIError.Transport("This computer is offline.")
        val result = activeClient.prepareSpeech(text, voiceId)
        return acceptCurrent(activeClient) { result }
    }

    suspend fun speak(text: String, voiceId: String?): ByteArray {
        val activeClient = client ?: throw APIError.Transport("This computer is offline.")
        val result = activeClient.speak(text, voiceId)
        return acceptCurrent(activeClient) { result }
    }

    suspend fun updateVoiceKey(key: String): String? {
        val activeClient = client ?: return "This computer is offline."
        return try {
            activeClient.updateVoiceKey(key)
            acceptCurrent(activeClient) { null }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            error.message ?: "Couldn't save the key."
        }
    }

    suspend fun updateVoiceProvider(provider: String): String? {
        val activeClient = client ?: return "This computer is offline."
        return try {
            activeClient.updateVoiceProvider(provider)
            acceptCurrent(activeClient) { null }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            error.message ?: "Couldn't change the voice engine."
        }
    }

    suspend fun configStatus(): ConfigStatus? = requestCurrent(quietly = true) { it.config() }

    suspend fun switchVoiceProvider(provider: VoiceProvider): ConfigStatus? =
        requestCurrent { it.updateVoiceProvider(provider) }

    suspend fun loadConnectorCatalog(): ConnectorCatalog? = requestCurrent { it.connectorCatalog() }

    suspend fun loadAllConnectorStatuses(): ConnectorStatuses? = requestCurrent { it.allConnectorStatuses() }

    suspend fun authorizeConnector(slug: String, alias: String?): URI? = requestCurrent { it.authorizeConnector(slug, alias) }

    suspend fun loadRoutines(): RoutinesResponse = requestCurrent { it.routines() } ?: RoutinesResponse(emptyList(), emptyList())

    suspend fun loadOverview(botId: String): BotOverview? = requestCurrent { it.overview(botId) }

    suspend fun loadRoutineRunAvailability(): RoutineRunAvailability? = requestCurrent { origin ->
        coroutineScope {
            val config = async { origin.config() }
            val instances = async { origin.instances() }
            RoutineRunAvailability(config.await(), instances.await())
        }
    }

    suspend fun saveRoutine(input: RoutineInput, id: String?): Routine? = requestCurrent {
        if (id == null) it.createRoutine(input) else it.updateRoutine(id, input)
    }

    suspend fun setRoutineEnabled(routine: Routine, enabled: Boolean): Routine? =
        requestCurrent { it.setRoutineEnabled(routine.id, enabled) }

    suspend fun runRoutine(routine: Routine): RoutineRun? = requestCurrent { it.runRoutine(routine.id) }

    suspend fun deleteRoutine(routine: Routine): Boolean = requestCurrent { it.deleteRoutine(routine.id); true } ?: false

    suspend fun react(to: Message, inThreadId: String, emoji: String) {
        requestCurrent(apply = { message -> _state.update { it.apply(Frame.MessagePatch(inThreadId, message)) } }) {
            it.toggleReaction(inThreadId, to.id, emoji)
        }
    }

    suspend fun edit(message: Message, forBot: Bot, text: String) {
        if (client == null) return
        val threadId = forBot.threadId
        val pending = PendingEdit(message.id, text, baseLeafId = _state.value.botForThread(threadId)?.activeLeafId)
        _state.update { it.copy(pendingEdits = it.pendingEdits + (threadId to pending)) }
        try {
            perform { activeClient ->
                val fork = activeClient.edit(forBot.id, message.id, text, threadId, pending.requestId)
                if (fork != null) acceptCurrent(activeClient) {
                    _state.update { it.adoptEdit(fork, threadId, expectedPending = pending) }
                }
            }
        } finally {
            _state.update {
                if (it.pendingEdits[threadId] == pending) it.copy(pendingEdits = it.pendingEdits - threadId) else it
            }
        }
    }

    suspend fun switchVersion(to: Message, forBot: Bot) {
        requestCurrent(apply = { leaf -> _state.update { it.apply(Frame.Thread(forBot.threadId, leaf)) } }) {
            it.setActiveBranch(forBot.id, to.id, forBot.threadId)
        }
    }

    suspend fun export(threadId: String, format: String): ExportedTranscript? = requestCurrent {
        val exported = it.export(threadId, format)
        ExportedTranscript(exported.data, exported.filename, exported.contentType)
    }

    private suspend fun <T> acceptCurrent(origin: CompanionClient, accept: () -> T): T {
        currentCoroutineContext().ensureActive()
        return gate.withLock {
            if (client !== origin) throw CancellationException("The originating computer changed")
            accept()
        }
    }

    private suspend fun <T> requestCurrent(
        origin: CompanionClient? = client,
        quietly: Boolean = false,
        apply: (T) -> Unit = {},
        request: suspend (CompanionClient) -> T,
    ): T? {
        origin ?: return null
        return try {
            acceptCurrent(origin) { Unit }
            val result = request(origin)
            currentCoroutineContext().ensureActive()
            gate.withLock {
                if (client !== origin) null else result.also(apply)
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            gate.withLock {
                if (client === origin) {
                    if ((error as? APIError)?.isUnauthorized == true) _status.value = Status.Unauthorized
                    if (!quietly) _actionError.value = error.message
                }
            }
            currentCoroutineContext().ensureActive()
            null
        }
    }

    private suspend fun perform(quietly: Boolean = false, body: suspend (CompanionClient) -> Unit) {
        val activeClient = client ?: return
        try {
            body(activeClient)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            gate.withLock {
                if (client !== activeClient) return@withLock
                if (error is APIError && error.isUnauthorized) {
                    _status.value = Status.Unauthorized
                } else if (!quietly) {
                    _actionError.value = error.message
                }
            }
        }
    }

    companion object {
        const val STORAGE_UNAVAILABLE_MESSAGE =
            "This phone couldn't read its saved connection just now."
        const val SPENT_QR_MESSAGE =
            "That pairing code was already used. Start pairing again on your computer and rescan the new QR code."
        const val THREAD_GONE_MESSAGE = "That thread is no longer on your computer."

        // A high-entropy QR credential is distinct from a retryable six-digit pairing code.
        fun isQrCredential(credential: String): Boolean =
            credential.startsWith("omb_pair_") ||
                !(credential.length == 6 && credential.all { it in '0'..'9' })
    }
}

class PairingInProgressException : IllegalStateException("Another pairing attempt is already in progress.")

/** Thrown when a burned QR credential is presented again. */
class SpentPairingCredentialException : IllegalStateException(Session.SPENT_QR_MESSAGE)

sealed interface ClaudeUpdateResult {
    data class Updated(val version: String) : ClaudeUpdateResult
    data class Failed(val message: String) : ClaudeUpdateResult
}
