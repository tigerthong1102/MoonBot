// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield

// Pairing credentials are redeemable once and cannot be replaced by a concurrent unconfirmed invite.
@OptIn(ExperimentalCoroutinesApi::class)
class SessionInviteLifecycleTest {
    private val first = "omb_pair_" + "1".repeat(43)
    private val second = "omb_pair_" + "2".repeat(43)

    private fun link(credential: String, host: String) =
        "openmausbot://pair?address=$host:8810&token=$credential"

    private fun codeLink(code: String, host: String) =
        "openmausbot://pair?address=$host:8810&code=$code"

    private fun paired(connection: Connection) = PairingOutcome(
        PairResponse(
            token = "device-token",
            device = PairedDevice("d1", "Pixel", 1.0, 1.0),
            serverName = "Mac",
        ),
        connection,
    )

    @Test
    fun aLinkArrivingDuringAnAttemptWaitsInsteadOfTakingTheCredentialSlot() = runTest {
        val redeeming = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val session = session(
            pairOutcomeFn = { _, _, _, _ ->
                redeeming.complete(Unit)
                release.await()
                throw APIError.Transport("the network went away")
            },
        )
        session.awaitRestored()

        session.receivePairingURL(link(first, "192.168.1.2"))
        val invite = assertNotNull(session.pairingInvite.value)
        assertEquals(first, invite.credential)
        // What the pairing screen does with a published invite: it takes it and
        // opens a credential slot for it.
        session.consumePairingInvite()

        val attempt = backgroundScope.async { runCatching { session.pair(invite, "request-1") } }
        redeeming.await()

        session.receivePairingURL(link(second, "192.168.1.9"))
        assertNull(
            session.pairingInvite.value,
            "the second link was published onto the screen while the first credential " +
                "was still being redeemed",
        )

        release.complete(Unit)
        attempt.await()

        val released = assertNotNull(session.pairingInvite.value)
        assertEquals(second, released.credential)
        assertEquals("192.168.1.9", released.connection.host)
    }

    @Test
    fun aWaitingLinkIsConsumedByASuccessfulPairingAndNeverReturnsAfterUnpair() = runTest {
        val redeeming = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val session = session(
            connectionStore = RecordingConnectionStore(),
            tokenStore = RecordingTokenStore(),
            pairOutcomeFn = { connection, _, _, _ ->
                redeeming.complete(Unit)
                release.await()
                paired(connection)
            },
        )
        session.awaitRestored()

        session.receivePairingURL(link(first, "192.168.1.2"))
        val invite = assertNotNull(session.pairingInvite.value)
        session.consumePairingInvite()

        val attempt = backgroundScope.async { session.pair(invite, "request-1") }
        redeeming.await()
        session.receivePairingURL(link(second, "192.168.1.9"))
        release.complete(Unit)
        attempt.await()

        assertNotNull(session.connection.value)
        assertNull(
            session.pairingInvite.value,
            "a successful pairing left the waiting one-time invite on the screen",
        )

        session.signOutAndAwait()
        assertNull(
            session.pairingInvite.value,
            "the invite that waited during the commit reopened pairing after unpairing",
        )
        advanceUntilIdle()
        assertNull(session.pairingInvite.value)
    }

    @Test
    fun aSuccessfulPairingEmptiesTheQueueBeforeStatusEverCatchesUp() = runTest {
        val session = session(pairOutcomeFn = { connection, _, _, _ -> paired(connection) })
        session.awaitRestored()
        session.receivePairingURL(codeLink("123456", "192.168.1.2"))
        val invite = assertNotNull(session.pairingInvite.value)

        session.pair(invite, "request-1")

        assertNull(
            session.pairingInvite.value,
            "a successful pairing left its one-time invite in the queue",
        )
        assertIs<Session.Status.Unpaired>(session.status.value)
        assertNotNull(session.connection.value)

        session.receivePairingURL(link(second, "192.168.1.9"))

        assertNotNull(
            session.pairingInvite.value,
            "a paired phone may add another computer without replacing the live one yet",
        )
    }

    @Test
    fun aWaitingLinkWhoseCredentialWasBurnedIsNotPresentedWhenTheAttemptEnds() = runTest {
        val redeeming = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val session = session(
            pairOutcomeFn = { _, _, _, _ ->
                redeeming.complete(Unit)
                release.await()
                throw APIError.Status(401, "pairing expired")
            },
        )
        session.awaitRestored()

        session.receivePairingURL(link(first, "192.168.1.2"))
        val invite = assertNotNull(session.pairingInvite.value)
        session.consumePairingInvite()

        val attempt = backgroundScope.async { runCatching { session.pair(invite, "request-1") } }
        redeeming.await()
        // The same QR scanned twice: the copy that waits is the credential the
        // attempt is about to have refused and burned.
        session.receivePairingURL(link(first, "10.0.0.5"))
        release.complete(Unit)
        attempt.await()

        assertNull(
            session.pairingInvite.value,
            "a credential the computer had already refused came back as a fresh invite",
        )
    }

    @Test
    fun unpairingEmptiesTheInviteQueue() = runTest {
        val session = session()
        session.awaitRestored()
        session.receivePairingURL(link(first, "192.168.1.2"))
        assertNotNull(session.pairingInvite.value)

        session.signOutAndAwait()

        assertNull(session.pairingInvite.value, "unpairing left a one-time invite in the queue")
    }

    @Test
    fun theFireAndForgetUnpairEmptiesTheInviteQueueToo() = runTest {
        val session = session()
        session.awaitRestored()
        session.receivePairingURL(link(first, "192.168.1.2"))
        assertNotNull(session.pairingInvite.value)

        session.signOut()
        yield()
        advanceUntilIdle()

        assertNull(session.pairingInvite.value, "unpairing left a one-time invite in the queue")
    }

    private suspend fun TestScope.aDeferredInviteBehindAFailingAttempt(): DeferredInviteScene {
        val redeeming = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val session = session(
            pairOutcomeFn = { _, _, _, _ ->
                redeeming.complete(Unit)
                release.await()
                throw APIError.Transport("the network went away")
            },
        )
        session.awaitRestored()
        session.receivePairingURL(link(first, "192.168.1.2"))
        val invite = assertNotNull(session.pairingInvite.value)
        session.consumePairingInvite()

        val attempt = backgroundScope.async { runCatching { session.pair(invite, "request-1") } }
        redeeming.await()
        session.receivePairingURL(link(second, "192.168.1.9"))
        return DeferredInviteScene(session, attempt, release)
    }

    @Test
    fun anUnpairWaitingOnTheGateTakesTheInviteThatAttemptReleases() = runTest {
        val scene = aDeferredInviteBehindAFailingAttempt()

        val unpaired = backgroundScope.async { scene.session.signOutAndAwait() }
        yield()
        assertFalse(unpaired.isCompleted, "the unpair did not queue behind the running attempt")

        scene.release.complete(Unit)
        scene.attempt.await()
        unpaired.await()

        assertNull(
            scene.session.pairingInvite.value,
            "the invite released by the failing attempt outlived the unpair queued behind it",
        )
    }

    @Test
    fun theFireAndForgetUnpairAlsoTakesTheInviteReleasedBehindIt() = runTest {
        val scene = aDeferredInviteBehindAFailingAttempt()

        scene.session.signOut()
        yield()

        scene.release.complete(Unit)
        scene.attempt.await()
        yield()
        advanceUntilIdle()

        assertNull(
            scene.session.pairingInvite.value,
            "the invite released by the failing attempt outlived the unpair queued behind it",
        )
    }

    private fun TestScope.session(
        connectionStore: ConnectionStore = RecordingConnectionStore(),
        tokenStore: TokenStore = RecordingTokenStore(),
        pairOutcomeFn: suspend (Connection, String, String, String) -> PairingOutcome =
            { _, _, _, _ -> error("pair not expected") },
    ): Session = Session(
        scope = backgroundScope,
        connectionStore = connectionStore,
        tokenStore = tokenStore,
        onboardingStore = InMemoryOnboardingStore(),
        deviceNameProvider = { "Pixel" },
        clientFactory = { connection, token -> CompanionClient(connection, token) },
        pairFn = pairOutcomeFn,
        eventsFn = { _, _, _ -> emptyFlow() },
        hydrateFn = { _, _ -> Fleet(emptyList(), emptyList()) },
        metadataFn = { throw APIError.Status(404) },
    )
}

private class DeferredInviteScene(
    val session: Session,
    val attempt: Deferred<Result<Unit>>,
    val release: CompletableDeferred<Unit>,
)

private class RecordingConnectionStore : ConnectionStore {
    var saved: Connection? = null
    override suspend fun load(): Connection? = saved
    override suspend fun save(connection: Connection) {
        saved = connection
    }
    override suspend fun clear() {
        saved = null
    }
}

private class RecordingTokenStore : TokenStore {
    private val saved = linkedMapOf<String, String>()
    override suspend fun save(connectionId: String, token: String) {
        saved[connectionId] = token
    }
    override suspend fun read(connectionId: String): TokenStore.ReadResult =
        saved[connectionId]?.let(TokenStore.ReadResult::Found) ?: TokenStore.ReadResult.Missing
    override suspend fun remove(connectionId: String) {
        saved.remove(connectionId)
    }
}
