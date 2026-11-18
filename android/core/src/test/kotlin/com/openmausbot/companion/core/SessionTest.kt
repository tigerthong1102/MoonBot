// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.core

import java.net.ConnectException
import java.net.UnknownHostException
import kotlin.coroutines.CoroutineContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.encodeToString
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer

@OptIn(ExperimentalCoroutinesApi::class)
class SessionTest {
    @Test
    fun coldReconnectFetchesWaitingChannelTasksBeforeCommittingTheCursor() = runBlocking {
        val server = MockWebServer()
        server.start()
        val scope = CoroutineScope(Job() + kotlinx.coroutines.Dispatchers.Default)
        try {
            val connection = requireNotNull(Connection.parse(server.url("/").toString()))
            val room = Room("room", "selected", "Fixture", emptyList(), GroupResponder("all"), "", false, 1.0,
                tasks = listOf(BotTask("background", "Review", 1.0, activity = "waiting-on-you")))
            val fleet = Fleet(emptyList(), listOf(room))
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody("""{"messages":[{"id":"pending","role":"bot","kind":"options","at":1,"card":{"title":"Allow?","subtitle":"","options":["Allow","Deny"],"requestId":"request","tool":"fixture"}}]}"""))
            val session = Session(scope = scope, connectionStore = FakeConnectionStore(connection),
                tokenStore = FakeTokenStore().apply { saved[connection.id] = "fixture-token" },
                onboardingStore = InMemoryOnboardingStore(), deviceNameProvider = { "Fixture" },
                eventsFn = { _, _, _ -> flow { emit(StreamFrame(Frame.Hello("cold:1", false), 1)); awaitCancellation() } },
                hydrateFn = { _, _ -> fleet.copy(groups = listOf(room)) }, instancesFn = { emptyList() },
                metadataFn = { throw APIError.Status(404) })
            session.awaitRestored()
            session.connect()
            val state = kotlinx.coroutines.withTimeout(5_000) { session.state.first { it.cursor == "cold:1" } }
            assertEquals(listOf("background"), state.pendingApprovals.map { it.threadId })
            assertEquals("/api/threads/background/messages?limit=50", server.takeRequest(5, java.util.concurrent.TimeUnit.SECONDS)?.path)
        } finally { scope.cancel(); server.shutdown() }
    }

    @Test
    fun textOnlySendsReportAcknowledgmentAndKeepTheRetryIdentity() = runTest {
        val server = MockWebServer()
        server.start()
        try {
            val connection = requireNotNull(Connection.parse(server.url("/").toString()))
            val tokens = FakeTokenStore().apply { saved[connection.id] = "fixture-token" }
            val session = session(connectionStore = FakeConnectionStore(connection), tokenStore = tokens)
            session.awaitRestored()
            val bot = decodeFixture<Fleet>("bots-paged").bots.first()
            val chat = Chat.BotChat(bot)
            var firstSendId: String? = null
            for (status in listOf(500, 200)) {
                server.enqueue(MockResponse().setResponseCode(status).setHeader("Content-Type", "application/json").setBody("{}"))
                assertEquals(status == 200, session.send("retryable draft", chat))
                val request = assertNotNull(server.takeRequest(5, java.util.concurrent.TimeUnit.SECONDS))
                val body = kotlinx.serialization.json.Json.parseToJsonElement(request.body.readUtf8()).jsonObject
                val sendId = body["sendId"].toString()
                assertTrue(sendId != "null")
                if (firstSendId == null) firstSendId = sendId else assertEquals(firstSendId, sendId)
                assertEquals("\"${bot.threadId}\"", body["threadId"].toString())
            }
            assertFalse(session.send("stale draft", emptyList(), chat, "other-computer"))
            assertEquals(2, server.requestCount)
        } finally { server.shutdown() }
    }

    @Test
    fun structuredQuestionRemainsRetryableUntilTheServerAcknowledgesIt() = runTest {
        val server = MockWebServer()
        server.start()
        try {
            val connection = requireNotNull(Connection.parse(server.url("/").toString()))
            val tokens = FakeTokenStore().apply { saved[connection.id] = "fixture-token" }
            val session = session(connectionStore = FakeConnectionStore(connection), tokenStore = tokens)
            session.awaitRestored()
            val card = OptionCard(title = "Question", subtitle = "", options = emptyList(), requestId = "ask",
                tool = "AskUserQuestion", questionRequest = QuestionRequestCardData(questions = listOf(AskQuestion("Notes?"))))
            for (status in listOf(500, 200, 401)) {
                server.enqueue(MockResponse().setResponseCode(status).setHeader("Content-Type", "application/json").setBody("{}"))
                assertEquals(status == 200, session.answerQuestion("thread", card, "fixture answer"))
                if (status == 200) assertNull(session.actionError)
                val request = assertNotNull(server.takeRequest(5, java.util.concurrent.TimeUnit.SECONDS))
                assertEquals("/api/threads/thread/respond", request.path)
                assertTrue(request.body.readUtf8().contains("\"behavior\":\"answer\""))
            }
            assertEquals(Session.Status.Unauthorized, session.status.value)
        } finally { server.shutdown() }
    }

    @Test
    fun restoreWithMissingConnectionStaysUnpaired() = runTest {
        val session = session()
        session.awaitRestored()
        assertEquals(Session.Status.Unpaired, session.status.value)
        assertEquals(Session.RestoreState.Unpaired, session.restoreState.value)
        assertNull(session.connection.value)
    }

    @Test
    fun lockedTokenIsOfflineNotUnpaired() = runTest {
        val connection = Connection(id = "c1", name = "Mac", host = "192.168.1.2", port = 8810)
        val tokens = FakeTokenStore().apply {
            unavailable["c1"] = TokenStore.ReadResult.Unavailable(locked = true, message = "locked")
        }
        val session = session(
            connectionStore = FakeConnectionStore(connection),
            tokenStore = tokens,
            events = { _, _ -> emptyFlow() },
        )
        session.awaitRestored()
        assertEquals(connection, session.connection.value)
        assertEquals(Session.RestoreState.Pending, session.restoreState.value)
        val status = assertIs<Session.Status.Offline>(session.status.value)
        assertEquals("Unlock this phone to reach your computer.", status.message)
    }

    @Test
    fun unavailableTokenErrorRemainsPendingWithoutLockedCopy() = runTest {
        val connection = Connection(id = "c1", name = "Mac", host = "192.168.1.2", port = 8810)
        val tokens = FakeTokenStore().apply {
            unavailable["c1"] = TokenStore.ReadResult.Unavailable(
                locked = false,
                message = "Secure storage is temporarily unavailable.",
            )
        }
        val session = session(
            connectionStore = FakeConnectionStore(connection),
            tokenStore = tokens,
            events = { _, _ -> emptyFlow() },
        )

        session.awaitRestored()

        assertEquals(connection, session.connection.value)
        assertEquals(Session.RestoreState.Pending, session.restoreState.value)
        assertEquals(
            "Secure storage is temporarily unavailable.",
            assertIs<Session.Status.Offline>(session.status.value).message,
        )
    }

    @Test
    fun restoredTokenIsReady() = runTest {
        val connection = Connection(id = "c1", name = "Mac", host = "192.168.1.2", port = 8810)
        val session = session(
            connectionStore = FakeConnectionStore(connection),
            tokenStore = FakeTokenStore().apply { saved["c1"] = "device-token" },
            events = { _, _ -> emptyFlow() },
        )

        session.awaitRestored()

        assertEquals(Session.RestoreState.Ready, session.restoreState.value)
        assertEquals(Session.Status.Connecting, session.status.value)
    }

    @Test
    fun pairPersistsTokenAndConnectionNeverCredential() = runTest {
        val connections = FakeConnectionStore()
        val tokens = FakeTokenStore()
        var pairedCredential: String? = null
        val session = session(
            connectionStore = connections,
            tokenStore = tokens,
            pairFn = { _, credential, deviceName ->
                pairedCredential = credential
                assertEquals("Pixel", deviceName)
                PairResponse(
                    token = "device-token-abc",
                    device = PairedDevice("d1", "Pixel", 1.0, 1.0),
                    serverName = "Ada's Mac",
                    hosts = listOf("mac.ts.net", "192.168.1.2"),
                )
            },
            events = { _, _ -> emptyFlow() },
        )
        session.awaitRestored()

        session.pair(
            Connection(name = "invite", host = "192.168.1.2", port = 8810),
            "omb_pair_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLM",
        )
        advanceUntilIdle()

        assertEquals("omb_pair_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLM", pairedCredential)
        assertEquals("device-token-abc", tokens.saved[connections.saved!!.id])
        assertEquals("Ada's Mac", connections.saved!!.name)
        assertTrue(tokens.saved.values.none { it.startsWith("omb_pair_") })
    }

    @Test
    fun pairEstablishesPolicyBeforeAnyProbeAndFiltersTheResponse() = runTest {
        val connections = FakeConnectionStore()
        val selected = assertNotNull(
            CompanionEndpoint.create("http://192.168.1.42:8810", CompanionEndpointKind.LAN, 0),
        )
        val advertisedSelected = assertNotNull(
            CompanionEndpoint.create("http://192.168.1.42:8810", CompanionEndpointKind.LAN, 200),
        )
        val otherLocal = assertNotNull(
            CompanionEndpoint.create("http://192.168.1.99:8810", CompanionEndpointKind.LAN, 50),
        )
        val tailnet = assertNotNull(
            CompanionEndpoint.create(
                "http://mac.tail1234.ts.net:8810",
                CompanionEndpointKind.TAILNET,
                100,
            ),
        )
        val hosted = assertNotNull(
            CompanionEndpoint.create("https://mac.example", CompanionEndpointKind.HOSTED, 0),
        )
        val session = session(
            connectionStore = connections,
            pairOutcomeFn = { invited, _, _, _ ->
                assertEquals(
                    setOf(CompanionEndpointKind.LAN, CompanionEndpointKind.HOSTED),
                    invited.allowedRouteKinds,
                    "the consent boundary must exist before pairFirstReachable probes or posts",
                )
                assertEquals(setOf(selected.url), invited.allowedLocalRouteURLs)
                PairingOutcome(
                    response = PairResponse(
                        token = "device-token",
                        device = PairedDevice("d1", "Pixel", 1.0, 1.0),
                        serverName = "Mac",
                        hosts = listOf(otherLocal.host, selected.host, tailnet.host),
                        endpoints = listOf(otherLocal, tailnet, hosted, advertisedSelected),
                    ),
                    connection = invited,
                )
            },
            events = { _, _ -> emptyFlow() },
        )
        session.awaitRestored()

        session.pair(
            Connection(
                name = "Mac",
                host = selected.host,
                port = selected.port,
                activeEndpoint = selected,
                endpoints = listOf(selected),
            ),
            "123456",
        )
        advanceUntilIdle()

        val stored = assertNotNull(connections.saved)
        assertEquals(
            setOf(CompanionEndpointKind.LAN, CompanionEndpointKind.HOSTED),
            stored.allowedRouteKinds,
        )
        assertEquals(setOf(selected.url), stored.allowedLocalRouteURLs)
        assertEquals(
            listOf(hosted.url, advertisedSelected.url),
            stored.endpoints.orEmpty().map { it.url },
            "the pair response must not persist unconsented authorities even if reads filter them",
        )
        assertEquals(listOf(hosted.url, selected.url), stored.orderedEndpoints.map { it.url })
        assertEquals(listOf(selected.host), stored.hosts)
    }

    @Test
    fun pairPersistsTypedEndpointMetadataAndKeepsTheRedeemingHttpsRouteActive() = runTest {
        val connections = FakeConnectionStore()
        val hosted = assertNotNull(
            CompanionEndpoint.create("https://mac.example", CompanionEndpointKind.HOSTED, 0),
        )
        val lan = assertNotNull(
            CompanionEndpoint.create("http://192.168.1.42:8810", CompanionEndpointKind.LAN, 200),
        )
        val session = session(
            connectionStore = connections,
            pairFn = { _, _, _ ->
                PairResponse(
                    token = "device-token",
                    device = PairedDevice("d1", "Pixel", 1.0, 1.0),
                    serverName = "Ada's Mac",
                    endpoints = listOf(hosted, lan),
                )
            },
            events = { _, _ -> emptyFlow() },
        )
        session.awaitRestored()

        val invitation = assertNotNull(Connection.parse("https://mac.example"))
        session.pair(invitation, "123456")
        advanceUntilIdle()

        val stored = assertNotNull(connections.saved)
        assertEquals("https://mac.example", stored.activeEndpoint?.url)
        assertEquals(listOf(hosted), stored.endpoints)
        assertEquals(setOf(CompanionEndpointKind.HOSTED), stored.allowedRouteKinds)
        assertEquals("https://mac.example", stored.baseUrl.toString())
        assertFalse(CompanionJson.encodeToString(stored).contains("device-token"))
    }

    @Test
    fun pairPersistsTheFallbackEndpointThatActuallyReturnedTheToken() = runTest {
        val connections = FakeConnectionStore()
        val hosted = assertNotNull(
            CompanionEndpoint.create("https://mac.example", CompanionEndpointKind.HOSTED, 0),
        )
        val tailnet = assertNotNull(
            CompanionEndpoint.create(
                "http://mac.tail1234.ts.net:8810",
                CompanionEndpointKind.TAILNET,
                100,
            ),
        )
        val invitation = Connection(
            name = "Mac",
            host = tailnet.host,
            port = tailnet.port,
            activeEndpoint = tailnet,
            endpoints = listOf(tailnet, hosted),
        )
        val session = session(
            connectionStore = connections,
            pairOutcomeFn = { invited, _, _, _ ->
                PairingOutcome(
                    PairResponse(
                        token = "device-token",
                        device = PairedDevice("d1", "Pixel", 1.0, 1.0),
                        serverName = "Mac",
                        endpoints = listOf(hosted, tailnet),
                    ),
                    invited.dialing(tailnet),
                )
            },
            events = { _, _ -> emptyFlow() },
        )
        session.awaitRestored()

        session.pair(invitation, "123456", "request-id-winner")
        advanceUntilIdle()

        val stored = assertNotNull(connections.saved)
        assertEquals(tailnet, stored.activeEndpoint)
        assertEquals(tailnet.host, stored.host)
        assertEquals(listOf(tailnet.host), stored.hosts)
        assertEquals(
            setOf(CompanionEndpointKind.TAILNET, CompanionEndpointKind.HOSTED),
            stored.allowedRouteKinds,
        )
        assertEquals(tailnet, session.connection.value?.activeEndpoint)
    }

    @Test
    fun hostedFailureNeverDialsOrPersistsLanCleartextWithTheToken() = runTest {
        val hosted = assertNotNull(Connection.parse("https://mac.example")).copy(
            id = "hosted",
            name = "Mac",
            hosts = listOf("mac.example", "192.168.1.42"),
        )
        val connections = FakeConnectionStore(hosted)
        val attempts = mutableListOf<Pair<Connection, String?>>()
        var opens = 0
        val session = session(
            connectionStore = connections,
            tokenStore = FakeTokenStore().apply { saved[hosted.id] = "device-token" },
            clientFactory = { connection, token ->
                attempts += connection to token
                CompanionClient(connection, token)
            },
            events = { _, _ ->
                opens++
                if (opens == 1) {
                    flow { throw ConnectException("refused") }
                } else {
                    flow {
                        emit(StreamFrame(Frame.Hello(cursor = "hosted:1", resumed = true), seq = 1))
                    }
                }
            },
        )
        session.awaitRestored()

        session.connect()
        runCurrent()

        assertEquals(1, attempts.size)
        assertTrue(attempts.all { (connection, token) ->
            connection.baseUrl.toString() == "https://mac.example" && token == "device-token"
        })
        val offline = assertIs<Session.Status.Offline>(session.status.value).message
        assertFalse(offline.contains("192.168.1.42"))
        assertFalse(offline.contains("Trying"))

        advanceTimeBy(1_000)
        runCurrent()

        assertEquals("https://mac.example", session.connection.value?.activeEndpoint?.url)
        assertEquals("https://mac.example", connections.saved?.activeEndpoint?.url)
    }

    @Test
    fun aSavedTailnetRecordNeverWalksToItsLegacyLanFallback() = runTest {

        val saved = Connection(
            id = "legacy",
            name = "Mac",
            host = "mac.tail1234.ts.net",
            port = 8810,
            hosts = listOf("mac.tail1234.ts.net", "192.168.1.42", "openmausbot-aa.local"),
        )
        val connections = FakeConnectionStore(saved)
        val dialed = mutableListOf<String>()
        val session = session(
            connectionStore = connections,
            tokenStore = FakeTokenStore().apply { this.saved["legacy"] = "device-token" },
            clientFactory = { connection, token ->
                dialed += connection.baseUrl.toString()
                CompanionClient(connection, token)
            },
            events = { _, _ -> flow { throw UnknownHostException("mac.tail1234.ts.net") } },
        )
        session.awaitRestored()

        session.connect()
        runCurrent()
        advanceTimeBy(4_000)
        runCurrent()

        assertEquals(listOf("http://mac.tail1234.ts.net:8810"), dialed.distinct())
        val offline = assertIs<Session.Status.Offline>(session.status.value).message
        assertFalse(offline.contains("192.168.1.42"))
        assertFalse(offline.contains("openmausbot-aa.local"))
        assertFalse(offline.contains("Trying"))
    }

    @Test
    fun aTunnelGatewayFailureWalksToTheNextProtectedRouteAndSaysSo() = runTest {
        val hosted = assertNotNull(
            CompanionEndpoint.create("https://mac.example", CompanionEndpointKind.HOSTED, 0),
        )
        val tailnet = assertNotNull(
            CompanionEndpoint.create("http://mac.tail1234.ts.net:8810", CompanionEndpointKind.TAILNET, 100),
        )
        val lan = assertNotNull(
            CompanionEndpoint.create("http://192.168.1.42:8810", CompanionEndpointKind.LAN, 200),
        )
        val saved = Connection(
            id = "hosted",
            name = "Mac",
            host = hosted.host,
            port = hosted.port,
            activeEndpoint = hosted,
            endpoints = listOf(hosted, tailnet, lan),
        )
        val dialed = mutableListOf<String>()
        val connections = FakeConnectionStore(saved)
        var opens = 0
        val session = session(
            connectionStore = connections,
            tokenStore = FakeTokenStore().apply { this.saved["hosted"] = "device-token" },
            clientFactory = { connection, token ->
                dialed += connection.baseUrl.toString()
                CompanionClient(connection, token)
            },
            events = { _, _ ->
                opens += 1
                if (opens == 1) {
                    flow { throw APIError.Status(522) }
                } else {
                    flow {
                        emit(StreamFrame(Frame.Hello(cursor = "s:1", resumed = true), seq = 1))
                        awaitCancellation()
                    }
                }
            },
        )
        session.awaitRestored()

        session.connect()
        runCurrent()

        assertEquals(
            listOf("https://mac.example", "http://mac.tail1234.ts.net:8810"),
            dialed,
        )
        val offline = assertIs<Session.Status.Offline>(session.status.value).message
        assertTrue(offline.contains("HTTP 522"))
        assertTrue(offline.contains("Trying mac.tail1234.ts.net next."))
        assertFalse(offline.contains("192.168.1.42"))

        advanceTimeBy(1_100)
        runCurrent()

        assertEquals(Session.Status.Live, session.status.value)
        val stored = assertNotNull(connections.saved)
        assertEquals(tailnet.url, stored.activeEndpoint?.url)
        assertEquals("http://mac.tail1234.ts.net:8810", stored.baseUrl.toString())
        assertTrue(stored.orderedEndpoints.any { it.url == hosted.url })
    }

    @Test
    fun anApplicationErrorStaysOnTheRouteThatProducedIt() = runTest {
        val hosted = assertNotNull(
            CompanionEndpoint.create("https://mac.example", CompanionEndpointKind.HOSTED, 0),
        )
        val tailnet = assertNotNull(
            CompanionEndpoint.create("http://mac.tail1234.ts.net:8810", CompanionEndpointKind.TAILNET, 100),
        )
        val saved = Connection(
            id = "hosted",
            name = "Mac",
            host = hosted.host,
            port = hosted.port,
            activeEndpoint = hosted,
            endpoints = listOf(hosted, tailnet),
        )
        val dialed = mutableListOf<String>()
        val session = session(
            connectionStore = FakeConnectionStore(saved),
            tokenStore = FakeTokenStore().apply { this.saved["hosted"] = "device-token" },
            clientFactory = { connection, token ->
                dialed += connection.baseUrl.toString()
                CompanionClient(connection, token)
            },
            events = { _, _ -> flow { throw APIError.Status(500) } },
        )
        session.awaitRestored()

        session.connect()
        runCurrent()

        assertEquals(listOf("https://mac.example"), dialed)
        assertFalse(assertIs<Session.Status.Offline>(session.status.value).message.contains("Trying"))
    }

    @Test
    fun aLiveStreamLearnsHostedRoutesWithoutSwitchingTheRouteCarryingIt() = runTest {
        val local = assertNotNull(
            CompanionEndpoint.create("http://192.168.1.42:8810", CompanionEndpointKind.LAN, 200),
        )
        val hosted = assertNotNull(
            CompanionEndpoint.create("https://mac.example", CompanionEndpointKind.HOSTED, 0),
        )
        val tailnet = assertNotNull(
            CompanionEndpoint.create(
                "http://mac.tail1234.ts.net:8810",
                CompanionEndpointKind.TAILNET,
                100,
            ),
        )
        val otherLocal = assertNotNull(
            CompanionEndpoint.create("http://192.168.1.99:8810", CompanionEndpointKind.LAN, 50),
        )
        val saved = Connection(
            id = "local",
            name = "Mac",
            host = local.host,
            port = local.port,
            activeEndpoint = local,
            endpoints = listOf(local),
        ).establishingRoutePolicyFromInvite()
        val connections = FakeConnectionStore(saved)
        val dialed = mutableListOf<String>()
        val session = session(
            connectionStore = connections,
            tokenStore = FakeTokenStore().apply { this.saved["local"] = "device-token" },
            clientFactory = { connection, token ->
                dialed += connection.baseUrl.toString()
                CompanionClient(connection, token)
            },
            events = { _, _ ->
                flow {
                    emit(StreamFrame(Frame.Hello(cursor = "s:1", resumed = true), seq = 1))
                    awaitCancellation()
                }
            },
            metadata = {
                CompanionConnectionMetadata(
                    serverName = "Ada's Mac",
                    hosts = listOf(tailnet.host, otherLocal.host, local.host),
                    endpoints = listOf(otherLocal, tailnet, hosted, local),
                )
            },
        )
        session.awaitRestored()

        session.connect()
        runCurrent()

        assertEquals(Session.Status.Live, session.status.value)
        val stored = assertNotNull(connections.saved)
        assertEquals("Ada's Mac", stored.name)
        assertEquals(
            listOf(hosted, local),
            stored.endpoints,
            "the authenticated refresh must not persist unconsented authorities",
        )
        assertEquals(listOf(local.host), stored.hosts)
        assertEquals(listOf(hosted.url, local.url), stored.orderedEndpoints.map { it.url })
        assertEquals(listOf("http://192.168.1.42:8810"), dialed)
        assertEquals(local.url, stored.activeEndpoint?.url)

        assertFalse(CompanionJson.encodeToString(stored).contains("device-token"))
    }

    @Test
    fun aLearnedHostedRouteBecomesTheUpgradeWhenTheChosenLocalRouteFails() = runTest {
        val local = assertNotNull(
            CompanionEndpoint.create("http://192.168.1.42:8810", CompanionEndpointKind.LAN, 200),
        )
        val hosted = assertNotNull(
            CompanionEndpoint.create("https://mac.example", CompanionEndpointKind.HOSTED, 0),
        )
        val saved = Connection(
            id = "local",
            name = "Mac",
            host = local.host,
            port = local.port,
            activeEndpoint = local,
            endpoints = listOf(local),
        )
        val dialed = mutableListOf<String>()
        var opens = 0
        val session = session(
            connectionStore = FakeConnectionStore(saved),
            tokenStore = FakeTokenStore().apply { this.saved["local"] = "device-token" },
            clientFactory = { connection, token ->
                dialed += connection.baseUrl.toString()
                CompanionClient(connection, token)
            },
            events = { _, _ ->
                opens += 1
                if (opens == 1) {
                    flow {
                        emit(StreamFrame(Frame.Hello(cursor = "s:1", resumed = true), seq = 1))
                        throw UnknownHostException("192.168.1.42")
                    }
                } else {
                    flow { throw UnknownHostException("192.168.1.42") }
                }
            },
            metadata = {
                CompanionConnectionMetadata(
                    serverName = "Mac",
                    hosts = null,
                    endpoints = listOf(hosted, local),
                )
            },
        )
        session.awaitRestored()

        session.connect()
        runCurrent()

        assertEquals(listOf("http://192.168.1.42:8810"), dialed)
        assertFalse(assertIs<Session.Status.Offline>(session.status.value).message.contains("Trying"))

        advanceTimeBy(1_100)
        runCurrent()

        assertEquals(listOf("http://192.168.1.42:8810", "https://mac.example"), dialed)
        val offline = assertIs<Session.Status.Offline>(session.status.value).message
        assertTrue(offline.contains("192.168.1.42"))
        assertTrue(offline.contains("Trying https://mac.example next."))
    }

    @Test
    fun aProtectedFailoverDoesNotOutrankTheDesktopPolicyOnTheNextLaunch() = runTest {




        val hosted = assertNotNull(
            CompanionEndpoint.create("https://mac.example", CompanionEndpointKind.HOSTED, 0),
        )
        val tailnet = assertNotNull(
            CompanionEndpoint.create("http://mac.tail1234.ts.net:8810", CompanionEndpointKind.TAILNET, 100),
        )
        val lan = assertNotNull(
            CompanionEndpoint.create("http://192.168.1.42:8810", CompanionEndpointKind.LAN, 200),
        )
        val connections = FakeConnectionStore(
            Connection(
                id = "c1",
                name = "Mac",
                host = hosted.host,
                port = hosted.port,
                activeEndpoint = hosted,
                endpoints = listOf(hosted, tailnet),
            ),
        )
        val tokens = FakeTokenStore().apply { saved["c1"] = "device-token" }
        var dialing = ""
        val first = session(
            connectionStore = connections,
            tokenStore = tokens,
            clientFactory = { connection, token ->
                dialing = connection.baseUrl.toString()
                CompanionClient(connection, token)
            },
            events = { _, _ ->
                if (dialing == hosted.url) {
                    flow { throw APIError.Status(522) }
                } else {
                    flow {
                        emit(StreamFrame(Frame.Hello(cursor = "s:1", resumed = true), seq = 1))
                        awaitCancellation()
                    }
                }
            },
            metadata = {
                CompanionConnectionMetadata(
                    serverName = "Mac",
                    hosts = null,
                    endpoints = listOf(hosted, tailnet, lan),
                )
            },
        )
        first.awaitRestored()

        first.connect()
        runCurrent()
        advanceTimeBy(1_100)
        runCurrent()

        assertEquals(Session.Status.Live, first.status.value)
        first.disconnect()

        val persisted = assertNotNull(connections.saved)
        assertEquals(tailnet.url, persisted.activeEndpoint?.url, "tailnet carried the stream")
        assertEquals(
            listOf(hosted, tailnet),
            persisted.automaticEndpoints,
            "but the computer's advertised priority still governs between two protected routes",
        )

        val secondDialed = mutableListOf<String>()
        val second = session(
            connectionStore = FakeConnectionStore(persisted),
            tokenStore = tokens,
            clientFactory = { connection, token ->
                secondDialed += connection.baseUrl.toString()
                CompanionClient(connection, token)
            },
            events = { _, _ -> emptyFlow() },
            metadata = { throw APIError.Status(404) },
        )
        second.awaitRestored()

        assertEquals(
            listOf(hosted.url),
            secondDialed,
            "the launch goes back to the route the computer put first",
        )
    }

    @Test
    fun anUpgradeAwayFromAHandTypedLocalRouteSurvivesIntoTheNextSession() = runTest {
        val hosted = assertNotNull(
            CompanionEndpoint.create("https://mac.example", CompanionEndpointKind.HOSTED, 100),
        )
        val connections = FakeConnectionStore(
            Connection(
                id = "c1",
                name = "Mac",
                host = hosted.host,
                port = hosted.port,
                activeEndpoint = hosted,
                endpoints = listOf(hosted),
            ),
        )
        val tokens = FakeTokenStore().apply { saved["c1"] = "device-token" }
        val firstDialed = mutableListOf<String>()
        var dialing = ""
        val first = session(
            connectionStore = connections,
            tokenStore = tokens,
            clientFactory = { connection, token ->
                dialing = connection.baseUrl.toString()
                firstDialed += dialing
                CompanionClient(connection, token)
            },
            events = { _, _ ->
                if (dialing.startsWith("http://192.168.")) {
                    flow { throw ConnectException("refused") }
                } else {
                    flow {
                        emit(StreamFrame(Frame.Hello(cursor = "s:1", resumed = true), seq = 1))
                        awaitCancellation()
                    }
                }
            },
            metadata = { throw APIError.Status(404) },
        )
        first.awaitRestored()
        first.connect()
        runCurrent()
        assertEquals(Session.Status.Live, first.status.value)

        assertTrue(first.updateAddressAndAwait("192.168.1.42"))
        runCurrent()

        assertEquals(
            listOf("https://mac.example", "http://192.168.1.42:8810", "https://mac.example"),
            firstDialed,
        )
        assertEquals(
            "http://192.168.1.42:8810",
            assertNotNull(connections.saved).activeEndpoint?.url,
            "and it is the explicit choice while it is being tried",
        )

        advanceTimeBy(1_100)
        runCurrent()

        assertEquals(Session.Status.Live, first.status.value)
        assertEquals(hosted.url, firstDialed.last(), "the failed local route upgraded to hosted")
        first.disconnect()

        val persisted = assertNotNull(connections.saved)
        assertEquals(hosted.url, persisted.activeEndpoint?.url)
        assertTrue(
            persisted.endpoints.orEmpty().any { it.url == "http://192.168.1.42:8810" },
            "the superseded route stays stored for display and a later explicit choice",
        )
        assertEquals(
            listOf(hosted),
            persisted.automaticEndpoints,
            "but it is no longer a route the credential may walk to on its own",
        )

        val secondDialed = mutableListOf<String>()
        val second = session(
            connectionStore = FakeConnectionStore(persisted),
            tokenStore = tokens,
            clientFactory = { connection, token ->
                secondDialed += connection.baseUrl.toString()
                CompanionClient(connection, token)
            },
            events = { _, _ -> flow { throw ConnectException("refused") } },
            metadata = { throw APIError.Status(404) },
        )
        second.awaitRestored()

        second.connect()
        runCurrent()
        advanceTimeBy(4_000)
        runCurrent()

        assertEquals(
            listOf(hosted.url),
            secondDialed.distinct(),
            "the pruned cleartext route never carries the bearer again",
        )
        assertFalse(
            assertIs<Session.Status.Offline>(second.status.value).message.contains("192.168.1.42"),
        )
    }

    @Test
    fun aStoreThatCannotWriteTheRefreshedSnapshotDoesNotEndTheStream() = runTest {
        val local = assertNotNull(
            CompanionEndpoint.create("http://192.168.1.42:8810", CompanionEndpointKind.LAN, 200),
        )
        val hosted = assertNotNull(
            CompanionEndpoint.create("https://mac.example", CompanionEndpointKind.HOSTED, 0),
        )
        val connections = object : ConnectionStore {
            override suspend fun load() = Connection(
                id = "local",
                name = "Mac",
                host = local.host,
                port = local.port,
                activeEndpoint = local,
                endpoints = listOf(local),
            )
            override suspend fun save(connection: Connection): Unit =
                throw IllegalStateException("Secure storage is busy.")
            override suspend fun clear() = Unit
        }
        val session = session(
            connectionStore = connections,
            tokenStore = FakeTokenStore().apply { saved["local"] = "device-token" },
            events = { _, _ ->
                flow {
                    emit(StreamFrame(Frame.Hello(cursor = "s:1", resumed = true), seq = 1))
                    awaitCancellation()
                }
            },
            metadata = {
                CompanionConnectionMetadata(
                    serverName = "Mac",
                    hosts = null,
                    endpoints = listOf(hosted, local),
                )
            },
        )
        session.awaitRestored()

        session.connect()
        runCurrent()

        assertEquals(Session.Status.Live, session.status.value)
        assertTrue(backgroundScope.isActive)
    }

    @Test
    fun anEndpointRefreshThatFailsLeavesTheLiveSessionAlone() = runTest {
        val saved = Connection(id = "c1", name = "Mac", host = "192.168.1.42", port = 8810)
        val connections = FakeConnectionStore(saved)
        var refreshCalls = 0
        val session = session(
            connectionStore = connections,
            tokenStore = FakeTokenStore().apply { this.saved["c1"] = "device-token" },
            events = { _, _ ->
                flow {
                    emit(StreamFrame(Frame.Hello(cursor = "s:1", resumed = true), seq = 1))
                    awaitCancellation()
                }
            },
            metadata = {
                refreshCalls += 1
                throw APIError.Status(404)
            },
        )
        session.awaitRestored()

        session.connect()
        runCurrent()

        assertEquals(1, refreshCalls)
        assertEquals(Session.Status.Live, session.status.value)
        val stored = assertNotNull(connections.saved)
        assertEquals("http://192.168.1.42:8810", stored.baseUrl.toString())
        assertEquals("Mac", stored.name)
        assertNull(stored.endpoints)
    }

    @Test
    fun editingAddressPersistsAndDialsTheCompleteHttpsAuthority() = runTest {
        val original = Connection(id = "c1", name = "Mac", host = "192.168.1.42", port = 8810)
        val connections = FakeConnectionStore(original)
        val session = session(
            connectionStore = connections,
            tokenStore = FakeTokenStore().apply { saved[original.id] = "device-token" },
            events = { _, _ -> emptyFlow() },
        )
        session.awaitRestored()

        assertTrue(session.updateAddressAndAwait("https://new.example:9443"))

        val updated = assertNotNull(connections.saved)
        assertEquals(original.id, updated.id)
        assertEquals("https://new.example:9443", updated.activeEndpoint?.url)
        assertEquals("https://new.example:9443", updated.baseUrl.toString())
        assertEquals(setOf(CompanionEndpointKind.HOSTED), updated.allowedRouteKinds)
        assertEquals(emptySet(), updated.allowedLocalRouteURLs)
        assertEquals(updated, session.connection.value)
    }

    @Test
    fun editingTheAddressStopsPersistingThePreviouslyConsentedAuthorities() = runTest {
        val hosted = assertNotNull(
            CompanionEndpoint.create("https://mac.example", CompanionEndpointKind.HOSTED, 0),
        )
        val tailnet = assertNotNull(
            CompanionEndpoint.create(
                "http://mac.tail1234.ts.net:8810",
                CompanionEndpointKind.TAILNET,
                100,
            ),
        )
        val typed = assertNotNull(
            CompanionEndpoint.create("http://192.168.1.42:8810", CompanionEndpointKind.LAN, 0),
        )
        val paired = Connection(
            id = "tailnet",
            name = "Mac",
            host = tailnet.host,
            port = tailnet.port,
            hosts = listOf(tailnet.host),
            activeEndpoint = tailnet,
            endpoints = listOf(tailnet, hosted),
        ).establishingRoutePolicyFromInvite()
        val connections = FakeConnectionStore(paired)
        val session = session(
            connectionStore = connections,
            tokenStore = FakeTokenStore().apply { saved[paired.id] = "device-token" },
            events = { _, _ -> emptyFlow() },
        )
        session.awaitRestored()

        assertTrue(session.updateAddressAndAwait("192.168.1.42:8810"))

        val stored = assertNotNull(connections.saved)
        assertEquals(
            setOf(CompanionEndpointKind.LAN, CompanionEndpointKind.HOSTED),
            stored.allowedRouteKinds,
        )
        assertEquals(setOf(typed.url), stored.allowedLocalRouteURLs)
        assertEquals(
            listOf(typed, hosted),
            stored.endpoints,
            "the tailnet route the user replaced by hand must not stay on disk",
        )
        assertEquals(listOf(typed.host), stored.hosts)
        assertEquals(stored, session.connection.value)
    }

    @Test
    fun pairedPhoneAcceptsAnInviteForAnotherComputer() = runTest {
        val connection = Connection(id = "c1", name = "Mac", host = "192.168.1.2", port = 8810)
        val tokens = FakeTokenStore().apply { saved["c1"] = "tok" }
        val session = session(
            connectionStore = FakeConnectionStore(connection),
            tokenStore = tokens,
            events = { _, _ -> emptyFlow() },
        )
        session.awaitRestored()
        session.receivePairingURL("openmausbot://pair?address=10.0.0.1:8810&code=123456")
        assertNotNull(session.pairingInvite.value)
        assertTrue(session.pairingRequested.value)
    }

    @Test
    fun pairAddsAndSelectsAnotherComputer() = runTest {
        val connection = Connection(id = "c1", name = "Mac", host = "192.168.1.2", port = 8810)
        val connections = FakeConnectionStore(connection)
        val tokens = FakeTokenStore().apply { saved["c1"] = "tok" }
        var pairCalls = 0
        val session = session(
            connectionStore = connections,
            tokenStore = tokens,
            pairFn = { paired, _, _ ->
                pairCalls++
                PairResponse(
                    token = "other-token",
                    device = PairedDevice("other-device", "Pixel", 1.0, 1.0),
                    serverName = paired.name,
                    hosts = null,
                )
            },
            events = { _, _ -> emptyFlow() },
        )
        session.awaitRestored()
        session.pair(Connection(name = "other", host = "10.0.0.1", port = 8810), "123456")
        assertEquals(1, pairCalls)
        assertEquals("tok", tokens.saved["c1"])
        val persisted = connections.loadRegistry().registry
        assertEquals(2, persisted.connections.size)
        assertEquals("other", persisted.activeConnection?.name)
        assertEquals("other", session.connection.value?.name)
    }

    @Test
    fun signOutThenBeginPairingKeepsPairingRequested() = runTest {
        val connection = Connection(id = "c1", name = "Mac", host = "192.168.1.2", port = 8810)
        val removeStarted = CompletableDeferred<Unit>()
        val releaseRemove = CompletableDeferred<Unit>()
        val innerTokens = FakeTokenStore().apply { saved["c1"] = "tok" }
        val tokens = object : TokenStore {
            override suspend fun save(connectionId: String, token: String) =
                innerTokens.save(connectionId, token)
            override suspend fun read(connectionId: String) = innerTokens.read(connectionId)
            override suspend fun remove(connectionId: String) {

                removeStarted.complete(Unit)
                releaseRemove.await()
                innerTokens.remove(connectionId)
            }
        }
        val session = session(
            connectionStore = FakeConnectionStore(connection),
            tokenStore = tokens,
            events = { _, _ -> flow { awaitCancellation() } },
        )
        session.awaitRestored()

        val unpair = launch { session.signOutAndAwait() }
        removeStarted.await()
        session.beginPairing()
        assertTrue(session.pairingRequested.value)
        releaseRemove.complete(Unit)
        unpair.join()

        assertTrue(session.pairingRequested.value)
    }

    @Test
    fun signOutWithNothingPairedClearsPairingRequested() = runTest {
        val session = session(events = { _, _ -> emptyFlow() })
        session.awaitRestored()
        assertNull(session.connection.value)

        session.beginPairing()
        assertTrue(session.pairingRequested.value)

        session.signOutAndAwait()
        assertFalse(session.pairingRequested.value)
    }

    @Test
    fun coldStartDeepLinkWaitsForRestoreBeforeAccepting() = runTest {
        val connection = Connection(id = "c1", name = "Mac", host = "192.168.1.2", port = 8810)
        val restoreGate = CompletableDeferred<Unit>()
        val connections = object : ConnectionStore {
            override suspend fun load(): Connection? {
                restoreGate.await()
                return connection
            }
            override suspend fun save(connection: Connection) = Unit
            override suspend fun clear() = Unit
        }
        val session = session(
            connectionStore = connections,
            tokenStore = FakeTokenStore().apply { saved["c1"] = "tok" },
            events = { _, _ -> emptyFlow() },
        )
        session.receivePairingURL(
            "openmausbot://pair?address=10.0.0.1:8810&token=omb_pair_" + "a".repeat(43),
        )
        runCurrent()
        assertNull(session.pairingInvite.value)

        restoreGate.complete(Unit)
        session.awaitRestored()
        advanceUntilIdle()
        assertNotNull(session.pairingInvite.value)
        assertTrue(session.pairingRequested.value)
    }

    @Test
    fun routeFailureKeepsQrInviteAndReusesTheSameLogicalRequest() = runTest {
        val qr = "omb_pair_" + "b".repeat(43)
        val requestId = "4c825d5b-cf40-4db7-aac5-2455f805a8ec"
        var attempts = 0
        val requestIds = mutableListOf<String>()
        val session = session(
            pairOutcomeFn = { connection, _, _, seenRequestId ->
                attempts++
                requestIds += seenRequestId
                if (attempts == 1) throw PairingRouteError(listOf(connection.displayAddress))
                PairingOutcome(
                    PairResponse(
                        token = "device-token",
                        device = PairedDevice("d1", "Pixel", 1.0, 1.0),
                        serverName = "Mac",
                    ),
                    connection,
                )
            },
            events = { _, _ -> emptyFlow() },
        )
        session.awaitRestored()
        session.receivePairingURL("openmausbot://pair?address=192.168.1.2:8810&token=$qr&code=123456")
        assertEquals(qr, session.pairingInvite.value?.credential)

        assertFailsWith<PairingRouteError> {
            session.pair(session.pairingInvite.value!!, requestId)
        }
        assertEquals(qr, session.pairingInvite.value?.credential)
        assertFalse(session.actionError!!.contains("rescan", ignoreCase = true))

        session.pair(session.pairingInvite.value!!, requestId)
        advanceUntilIdle()
        assertEquals(2, attempts)
        assertEquals(listOf(requestId, requestId), requestIds)
        assertNotNull(session.connection.value)
    }

    @Test
    fun authoritativeQrRejectionBurnsInviteAndRejectsReplay() = runTest {
        val qr = "omb_pair_" + "e".repeat(43)
        var attempts = 0
        val session = session(
            pairOutcomeFn = { _, _, _, _ ->
                attempts++
                throw APIError.Status(401, "pairing expired")
            },
            events = { _, _ -> emptyFlow() },
        )
        session.awaitRestored()
        session.receivePairingURL("openmausbot://pair?address=192.168.1.2:8810&token=$qr")

        assertFailsWith<APIError.Status> {
            session.pair(session.pairingInvite.value!!, "request-id-authoritative")
        }
        assertNull(session.pairingInvite.value)
        assertTrue(session.actionError!!.contains("rescan the new QR code"))

        assertFailsWith<SpentPairingCredentialException> {
            session.pair(Connection(name = "Mac", host = "192.168.1.2", port = 8810), qr)
        }
        assertEquals(1, attempts)

        session.receivePairingURL("openmausbot://pair?address=192.168.1.2:8810&token=$qr&code=123456")
        assertNull(session.pairingInvite.value)
        assertTrue(session.actionError!!.contains("already used") || session.actionError!!.contains("rescan"))
    }

    @Test
    fun failedCodeRedeemRemainsRetryable() = runTest {
        var attempts = 0
        val session = session(
            pairFn = { _, _, _ ->
                attempts++
                if (attempts == 1) throw APIError.Transport("wrong code")
                PairResponse(
                    token = "device-token",
                    device = PairedDevice("d1", "Pixel", 1.0, 1.0),
                    serverName = "Mac",
                    hosts = null,
                )
            },
            events = { _, _ -> emptyFlow() },
        )
        session.awaitRestored()
        assertFailsWith<APIError.Transport> {
            session.pair(Connection(name = "Mac", host = "192.168.1.2", port = 8810), "123456")
        }
        session.pair(Connection(name = "Mac", host = "192.168.1.2", port = 8810), "123456")
        advanceUntilIdle()
        assertEquals(2, attempts)
        assertTrue(session.connection.value != null)
    }

    @Test
    fun concurrentPairOnlyOneWins() = runTest {
        val connections = FakeConnectionStore()
        val tokens = FakeTokenStore()
        val firstEntered = CompletableDeferred<Unit>()
        val releaseFirst = CompletableDeferred<Unit>()
        var pairCalls = 0
        val session = session(
            connectionStore = connections,
            tokenStore = tokens,
            pairFn = { _, credential, _ ->
                pairCalls++
                if (pairCalls == 1) {
                    firstEntered.complete(Unit)
                    releaseFirst.await()
                }
                PairResponse(
                    token = "tok-$credential",
                    device = PairedDevice("d1", "Pixel", 1.0, 1.0),
                    serverName = "Mac-$credential",
                    hosts = null,
                )
            },
            events = { _, _ -> emptyFlow() },
        )
        session.awaitRestored()

        var firstResult: Result<Unit>? = null
        var secondResult: Result<Unit>? = null
        val first = launch {
            firstResult = runCatching {
                session.pair(Connection(name = "a", host = "10.0.0.1", port = 8810), "111111")
            }
        }
        firstEntered.await()
        val second = launch {
            secondResult = runCatching {
                session.pair(Connection(name = "b", host = "10.0.0.2", port = 8810), "222222")
            }
        }
        runCurrent()
        assertTrue(second.isActive)
        releaseFirst.complete(Unit)
        advanceUntilIdle()
        first.join()
        second.join()

        assertEquals(2, pairCalls)
        assertTrue(firstResult!!.isSuccess)
        assertTrue(secondResult!!.isSuccess)
        assertEquals(setOf("tok-111111", "tok-222222"), tokens.saved.values.toSet())
        val persisted = connections.loadRegistry().registry
        assertEquals(2, persisted.connections.size)
        assertEquals(
            setOf("Mac-111111", "Mac-222222"),
            persisted.connections.map { it.name }.toSet(),
        )
        assertEquals("Mac-222222", persisted.activeConnection?.name)
        assertEquals("Mac-222222", connections.saved!!.name)
    }

    @Test
    fun qrBurnedWhenSaveFailsAfterSuccessfulRedeem() = runTest {
        val qr = "omb_pair_" + "c".repeat(43)
        var attempts = 0
        val tokens = object : TokenStore by FakeTokenStore() {
            override suspend fun save(connectionId: String, token: String) {
                error("disk full")
            }
        }
        val session = session(
            tokenStore = tokens,
            pairFn = { _, _, _ ->
                attempts++
                PairResponse(
                    token = "device-token",
                    device = PairedDevice("d1", "Pixel", 1.0, 1.0),
                    serverName = "Mac",
                    hosts = null,
                )
            },
            events = { _, _ -> emptyFlow() },
        )
        session.awaitRestored()

        assertFailsWith<IllegalStateException> {
            session.pair(Connection(name = "Mac", host = "192.168.1.2", port = 8810), qr)
        }
        assertNull(session.connection.value)
        assertTrue(session.actionError!!.contains("rescan the new QR code"))

        assertFailsWith<SpentPairingCredentialException> {
            session.pair(Connection(name = "Mac", host = "192.168.1.2", port = 8810), qr)
        }
        assertEquals(1, attempts)
    }

    @Test
    fun cancelledQrAttemptCanResumeWithTheSameLogicalRequest() = runTest {
        val qr = "omb_pair_" + "d".repeat(43)
        val requestId = "d350b2ac-7f92-4f30-bf80-21e040c1494b"
        var attempts = 0
        val requestIds = mutableListOf<String>()
        val redeemStarted = CompletableDeferred<Unit>()
        val blockRedeem = CompletableDeferred<Unit>()
        val session = session(
            pairOutcomeFn = { connection, _, _, seenRequestId ->
                attempts++
                requestIds += seenRequestId
                if (attempts == 1) {
                    redeemStarted.complete(Unit)
                    blockRedeem.await()
                }
                PairingOutcome(
                    PairResponse(
                        token = "device-token",
                        device = PairedDevice("d1", "Pixel", 1.0, 1.0),
                        serverName = "Mac",
                        hosts = null,
                    ),
                    connection,
                )
            },
            events = { _, _ -> emptyFlow() },
        )
        session.awaitRestored()

        val job = launch {
            session.pair(
                Connection(name = "Mac", host = "192.168.1.2", port = 8810),
                qr,
                requestId,
            )
        }
        redeemStarted.await()
        job.cancel()
        advanceUntilIdle()
        assertTrue(job.isCancelled)
        assertNull(session.connection.value)

        session.pair(
            Connection(name = "Mac", host = "192.168.1.2", port = 8810),
            qr,
            requestId,
        )
        advanceUntilIdle()
        assertEquals(2, attempts)
        assertEquals(listOf(requestId, requestId), requestIds)
        assertNotNull(session.connection.value)
    }

    @Test
    fun unpairClearsLocalStateOnly() = runTest {
        val connection = Connection(id = "c1", name = "Mac", host = "192.168.1.2", port = 8810)
        val connections = FakeConnectionStore(connection)
        val tokens = FakeTokenStore().apply { saved["c1"] = "tok" }
        val session = session(
            connectionStore = connections,
            tokenStore = tokens,
            events = { _, _ -> emptyFlow() },
        )
        session.awaitRestored()
        session.signOutAndAwait()
        assertEquals(Session.Status.Unpaired, session.status.value)
        assertNull(connections.saved)
        assertTrue(tokens.saved.isEmpty())
    }

    @Test
    fun createRoomFoldsTheResultAndSurfacesFailure() = runTest {
        val server = MockWebServer()
        server.start()
        try {
            val connection = requireNotNull(Connection.parse(server.url("/").toString()))
            val tokens = FakeTokenStore().apply { saved[connection.id] = "tok" }
            val session = session(
                connectionStore = FakeConnectionStore(connection),
                tokenStore = tokens,
            )
            session.awaitRestored()

            server.enqueue(MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"group":${roomJson()}}"""))
            val room = session.createRoom("Launch Team", listOf("b1", "b2"))

            assertEquals("g-new", room?.id)
            assertEquals(room, session.state.value.rooms.single())
            assertEquals(emptyList(), session.state.value.transcript("t-new"))
            assertNull(session.actionError)

            val taskRoom = roomTaskJson("t-room-2", "Second")
            server.enqueue(MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"group":$taskRoom}"""))
            session.createTask(requireNotNull(room), "Second")
            assertEquals("t-room-2", session.state.value.rooms.single().threadId)

            val switchedRoom = roomTaskJson("t-room-3", "Third")
            server.enqueue(MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"group":$switchedRoom}"""))
            session.switchTask(BotTask("t-room-3", "Third", 3.0), session.state.value.rooms.single())
            assertEquals("t-room-3", session.state.value.rooms.single().threadId)

            server.enqueue(MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"group":$taskRoom}"""))
            session.deleteTask(BotTask("t-room-3", "Third", 3.0), session.state.value.rooms.single())
            assertEquals("t-room-2", session.state.value.rooms.single().threadId)

            server.enqueue(MockResponse()
                .setResponseCode(403)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"error":"Room creation is not allowed."}"""))
            assertNull(session.createRoom(null, listOf("b1")))
            assertEquals("Room creation is not allowed.", session.actionError)
            assertEquals(listOf("g-new"), session.state.value.rooms.map(Room::id))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun helloNotResumedHydratesBeforeCommittingCursor() = runTest {
        var hydrateCalls = 0
        var opens = 0
        val hang = MutableSharedFlow<StreamFrame>(extraBufferCapacity = 1)
        val session = session(
            connectionStore = FakeConnectionStore(
                Connection(id = "c1", name = "Mac", host = "127.0.0.1", port = 8810),
            ),
            tokenStore = FakeTokenStore().apply { saved["c1"] = "tok" },
            events = { _, _ ->
                opens++
                hang
            },
            hydrate = {
                hydrateCalls++
                Fleet(
                    bots = listOf(sampleBot(id = "b1", threadId = "t1")),
                    groups = emptyList(),
                )
            },
        )
        session.awaitRestored()
        session.connect()
        runCurrent()
        assertEquals(1, opens)
        hang.tryEmit(StreamFrame(Frame.Hello(cursor = "stream:7", resumed = false), seq = 0))
        runCurrent()
        yield()
        runCurrent()

        assertEquals(1, hydrateCalls)
        assertEquals("stream:7", session.state.value.cursor)
        assertEquals(1, session.state.value.bots.size)
        assertEquals(Session.Status.Live, session.status.value)
    }

    @Test
    fun disconnectMidHydrateDoesNotCommitCursorAndReconnectRequestsGap() = runTest {
        val hang = MutableSharedFlow<StreamFrame>(extraBufferCapacity = 1)
        val hydrateStarted = CompletableDeferred<Unit>()
        val hydrateRelease = CompletableDeferred<Unit>()
        val opens = mutableListOf<String?>()
        val session = session(
            connectionStore = FakeConnectionStore(
                Connection(id = "c1", name = "Mac", host = "127.0.0.1", port = 8810),
            ),
            tokenStore = FakeTokenStore().apply { saved["c1"] = "tok" },
            events = { since, _ ->
                opens += since
                hang
            },
            hydrate = {
                hydrateStarted.complete(Unit)
                hydrateRelease.await()
                Fleet(
                    bots = listOf(sampleBot(id = "b1", threadId = "t1")),
                    groups = emptyList(),
                )
            },
        )
        session.awaitRestored()
        session.connect()
        runCurrent()
        hang.tryEmit(StreamFrame(Frame.Hello(cursor = "stream:9", resumed = false), seq = 0))
        runCurrent()
        hydrateStarted.await()
        assertNull(session.state.value.cursor)

        session.disconnect()
        runCurrent()
        hydrateRelease.cancel()
        assertNull(session.state.value.cursor)
        assertEquals(listOf<String?>(null), opens)

        session.connect()
        runCurrent()
        assertEquals(listOf<String?>(null, null), opens)
        assertNull(session.state.value.cursor)
    }

    @Test
    fun screenWatcherTurnsScreensOnAndLastCloseClears() = runTest {
        val hang = MutableSharedFlow<StreamFrame>(extraBufferCapacity = 4)
        val opens = mutableListOf<Pair<String?, Boolean>>()
        val session = session(
            connectionStore = FakeConnectionStore(
                Connection(id = "c1", name = "Mac", host = "127.0.0.1", port = 8810),
            ),
            tokenStore = FakeTokenStore().apply { saved["c1"] = "tok" },
            events = { since, screens ->
                opens += since to screens
                hang
            },
            hydrate = {
                Fleet(
                    bots = listOf(sampleBot(id = "b1", threadId = "t1")),
                    groups = emptyList(),
                )
            },
        )
        session.awaitRestored()
        session.connect()
        runCurrent()
        hang.tryEmit(StreamFrame(Frame.Hello(cursor = "stream:1", resumed = false), seq = 0))
        runCurrent()
        yield()
        runCurrent()
        hang.tryEmit(
            StreamFrame(
                Frame.Screen(botId = "b1", png = "AA==", mime = "image/png"),
                seq = 2,
            ),
        )
        runCurrent()
        assertEquals(listOf<Pair<String?, Boolean>>(null to false), opens)
        assertTrue(session.state.value.screens.containsKey("b1"))
        assertEquals("stream:2", session.state.value.cursor)

        session.watchScreen("b1")
        runCurrent()
        assertEquals(
            listOf<Pair<String?, Boolean>>(null to false, "stream:2" to true),
            opens,
        )

        session.watchScreen("b1")
        runCurrent()
        assertEquals(2, opens.size)

        session.stopWatchingScreen("b1")
        runCurrent()
        assertEquals(2, opens.size)
        assertTrue(session.state.value.screens.containsKey("b1"))

        session.stopWatchingScreen("b1")
        runCurrent()
        assertEquals(
            listOf<Pair<String?, Boolean>>(
                null to false,
                "stream:2" to true,
                "stream:2" to false,
            ),
            opens,
        )
        assertTrue(session.state.value.screens.isEmpty())
    }

    @Test
    fun streamEndingBeforeHelloTriesTheNextProtectedRoute() = runTest {
        val primary = assertNotNull(CompanionEndpoint.create("https://primary.example", CompanionEndpointKind.HOSTED, 0))
        val backup = assertNotNull(CompanionEndpoint.create("https://backup.example", CompanionEndpointKind.HOSTED, 1))
        val saved = Connection(id = "c1", name = "Mac", host = primary.host, port = primary.port,
            activeEndpoint = primary, endpoints = listOf(primary, backup))
        val dialed = mutableListOf<String>()
        val session = session(
            connectionStore = FakeConnectionStore(saved),
            tokenStore = FakeTokenStore().apply { this.saved["c1"] = "tok" },
            clientFactory = { connection, token ->
                dialed += connection.baseUrl.toString()
                CompanionClient(connection, token)
            },
            events = { _, _ ->
                if (dialed.last() == primary.url) emptyFlow() else flow {
                    emit(StreamFrame(Frame.Hello(cursor = "s:4", resumed = true), seq = 4))
                    awaitCancellation()
                }
            },
        )
        session.awaitRestored()
        session.connect()
        runCurrent()
        advanceTimeBy(1_000)
        runCurrent()
        assertEquals(listOf(primary.url, backup.url), dialed)
        assertEquals(Session.Status.Live, session.status.value)
    }

    @Test
    fun streamEndingAfterHelloReconnectsOnTheWorkingRouteWithItsCursor() = runTest {
        assertWorkingRouteReconnect()
    }

    @Test
    fun truncatedStreamAfterHelloReconnectsOnTheWorkingRouteWithItsCursor() = runTest {
        assertWorkingRouteReconnect(APIError.Transport("Truncated chunk", java.io.EOFException()))
    }

    private suspend fun kotlinx.coroutines.test.TestScope.assertWorkingRouteReconnect(streamFailure: Throwable? = null) {
        val primary = assertNotNull(CompanionEndpoint.create("https://primary.example", CompanionEndpointKind.HOSTED, 0))
        val backup = assertNotNull(CompanionEndpoint.create("https://backup.example", CompanionEndpointKind.HOSTED, 1))
        val saved = Connection(id = "c1", name = "Mac", host = primary.host, port = primary.port,
            activeEndpoint = primary, endpoints = listOf(primary, backup))
        val dialed = mutableListOf<String>()
        val cursors = mutableListOf<String?>()
        val session = session(
            connectionStore = FakeConnectionStore(saved),
            tokenStore = FakeTokenStore().apply { this.saved["c1"] = "tok" },
            clientFactory = { connection, token ->
                dialed += connection.baseUrl.toString()
                CompanionClient(connection, token)
            },
            events = { since, _ -> flow {
                cursors += since
                emit(StreamFrame(Frame.Hello(cursor = "s:4", resumed = false), seq = 4))
                if (cursors.size > 1) awaitCancellation()
                streamFailure?.let { throw it }
            } },
        )
        session.awaitRestored()
        session.connect()
        runCurrent()
        advanceTimeBy(1_000)
        runCurrent()
        assertEquals(listOf(primary.url), dialed)
        assertEquals(listOf(null, "s:4"), cursors)
        assertEquals(Session.Status.Live, session.status.value)
    }

    @Test
    fun cleanStreamEndBacksOffOneTwoFourCappedAtFifteen() = runTest {
        var opens = 0
        val session = session(
            connectionStore = FakeConnectionStore(
                Connection(id = "c1", name = "Mac", host = "127.0.0.1", port = 8810),
            ),
            tokenStore = FakeTokenStore().apply { saved["c1"] = "tok" },
            events = { _, _ ->
                opens++
                emptyFlow()
            },
        )
        session.awaitRestored()
        session.connect()
        runCurrent()
        assertEquals(1, opens)
        assertEquals(Session.Status.Offline("Lost the connection."), session.status.value)

        advanceTimeBy(1_000)
        runCurrent()
        assertEquals(2, opens)

        advanceTimeBy(2_000)
        runCurrent()
        assertEquals(3, opens)

        advanceTimeBy(4_000)
        runCurrent()
        assertEquals(4, opens)

        advanceTimeBy(8_000)
        runCurrent()
        assertEquals(5, opens)

        advanceTimeBy(15_000)
        runCurrent()
        assertEquals(6, opens)
    }

    @Test
    fun unauthorizedDoesNotRetry() = runTest {
        var opens = 0
        val session = session(
            connectionStore = FakeConnectionStore(
                Connection(id = "c1", name = "Mac", host = "127.0.0.1", port = 8810),
            ),
            tokenStore = FakeTokenStore().apply { saved["c1"] = "tok" },
            events = { _, _ ->
                opens++
                flow { throw APIError.Status(401, "revoked") }
            },
        )
        session.awaitRestored()
        session.connect()
        advanceUntilIdle()
        advanceTimeBy(60_000)
        advanceUntilIdle()
        assertEquals(Session.Status.Unauthorized, session.status.value)
        assertEquals(1, opens)
    }

    @Test
    fun deliberateDisconnectIsNotRetried() = runTest {
        val hang = MutableSharedFlow<StreamFrame>(extraBufferCapacity = 1)
        var opens = 0
        val session = session(
            connectionStore = FakeConnectionStore(
                Connection(id = "c1", name = "Mac", host = "127.0.0.1", port = 8810),
            ),
            tokenStore = FakeTokenStore().apply { saved["c1"] = "tok" },
            events = { _, _ ->
                opens++
                hang
            },
        )
        session.awaitRestored()
        session.connect()
        runCurrent()
        hang.tryEmit(StreamFrame(Frame.Hello(cursor = "s:1", resumed = true), seq = 1))
        runCurrent()
        assertEquals(Session.Status.Live, session.status.value)

        session.disconnect()
        advanceTimeBy(60_000)
        advanceUntilIdle()
        assertEquals(1, opens)
    }

    @Test
    fun refreshWaitsUntilLeavingConnectingOrTenSeconds() = runTest {
        val hang = MutableSharedFlow<StreamFrame>()
        val session = session(
            connectionStore = FakeConnectionStore(
                Connection(id = "c1", name = "Mac", host = "127.0.0.1", port = 8810),
            ),
            tokenStore = FakeTokenStore().apply { saved["c1"] = "tok" },
            events = { _, _ -> hang },
        )
        session.awaitRestored()
        val job = launch { session.refresh() }
        runCurrent()
        assertEquals(Session.Status.Connecting, session.status.value)
        advanceTimeBy(9_999)
        assertTrue(job.isActive)
        advanceTimeBy(2)
        advanceUntilIdle()
        assertTrue(job.isCompleted)
    }

    @Test
    fun refreshWhileLiveRestartsAndWaitsForSettlement() = runTest {
        val hang = MutableSharedFlow<StreamFrame>(extraBufferCapacity = 2)
        var opens = 0
        val session = session(
            connectionStore = FakeConnectionStore(
                Connection(id = "c1", name = "Mac", host = "127.0.0.1", port = 8810),
            ),
            tokenStore = FakeTokenStore().apply { saved["c1"] = "tok" },
            events = { _, _ ->
                opens++
                hang
            },
        )
        session.awaitRestored()
        session.connect()
        runCurrent()
        hang.tryEmit(StreamFrame(Frame.Hello(cursor = "s:1", resumed = true), seq = 1))
        runCurrent()
        assertEquals(Session.Status.Live, session.status.value)
        assertEquals(1, opens)

        val job = launch { session.refresh() }
        runCurrent()
        assertEquals(Session.Status.Connecting, session.status.value)
        assertTrue(job.isActive)
        assertEquals(2, opens)

        hang.tryEmit(StreamFrame(Frame.Hello(cursor = "s:1", resumed = true), seq = 2))
        runCurrent()
        advanceUntilIdle()
        assertEquals(Session.Status.Live, session.status.value)
        assertTrue(job.isCompleted)
    }

    @Test
    fun notifyFramesUseDedupeContractViaSink() = runTest {
        val notifications = RecordingNotifications()
        val hang = MutableSharedFlow<StreamFrame>(extraBufferCapacity = 2)
        val session = session(
            connectionStore = FakeConnectionStore(
                Connection(id = "c1", name = "Mac", host = "127.0.0.1", port = 8810),
            ),
            tokenStore = FakeTokenStore().apply { saved["c1"] = "tok" },
            notifications = notifications,
            events = { _, _ -> hang },
        )
        session.awaitRestored()
        session.connect()
        runCurrent()
        hang.tryEmit(StreamFrame(Frame.Hello(cursor = "s:1", resumed = true), seq = 1))
        hang.tryEmit(
            StreamFrame(
                Frame.Notify(
                    NotificationFrame(
                        kind = "approval",
                        botId = "b1",
                        botName = "Scout",
                        threadId = "t1",
                        title = "Allow?",
                        body = "rm -rf",
                    ),
                ),
                seq = 42,
            ),
        )
        runCurrent()
        assertEquals(1, notifications.delivered.size)
        assertEquals(42, notifications.delivered.single().second)
    }

    @Test
    fun addressFailureWalksCandidates() {
        val failure = ConnectionAdvice.classify(ConnectException("refused"))
        assertEquals(ConnectionFailure.CANNOT_CONNECT_TO_HOST, failure)
        assertTrue(ConnectionAdvice.shouldTryAnotherHost(failure))
        val message = ConnectionAdvice.message(failure, "192.168.1.2", 8810, tryingNext = "mac.ts.net")
        assertTrue(message.contains("Trying mac.ts.net next."))
        assertTrue(message.contains("port 8810"))
    }

    @Test
    fun aConnectionStoreThatThrowsStaysPairedAndOfflineInsteadOfEscaping() = runTest {
        val session = session(connectionStore = ThrowingConnectionStore(IllegalStateException()))
        session.awaitRestored()
        advanceUntilIdle()

        assertEquals(Session.RestoreState.Pending, session.restoreState.value)
        assertEquals(
            Session.STORAGE_UNAVAILABLE_MESSAGE,
            assertIs<Session.Status.Offline>(session.status.value).message,
        )
        assertEquals(Session.RestoreState.Pending, session.restoreState.value)
    }

    @Test
    fun aTokenStoreThatThrowsKeepsTheConnectionAndReportsOffline() = runTest {
        val connection = Connection(id = "c1", name = "Mac", host = "192.168.1.2", port = 8810)
        val session = session(
            connectionStore = FakeConnectionStore(connection),
            tokenStore = ThrowingTokenStore(IllegalStateException("Secure storage is busy.")),
        )
        session.awaitRestored()
        advanceUntilIdle()

        assertEquals(connection, session.connection.value)
        assertEquals(Session.RestoreState.Pending, session.restoreState.value)
        assertEquals(
            "Secure storage is busy.",
            assertIs<Session.Status.Offline>(session.status.value).message,
        )
    }

    @Test
    fun aClientThatCannotBeRebuiltStaysPairedAndOffline() = runTest {
        val connection = Connection(id = "c1", name = "Mac", host = "192.168.1.2", port = 8810)
        val session = session(
            connectionStore = FakeConnectionStore(connection),
            tokenStore = FakeTokenStore().apply { saved["c1"] = "tok" },
            clientFactory = { _, _ -> throw IllegalStateException("The saved address can't be dialled.") },
        )
        session.awaitRestored()
        advanceUntilIdle()

        assertEquals(connection, session.connection.value)
        assertEquals(Session.RestoreState.Pending, session.restoreState.value)
        assertEquals(
            "The saved address can't be dialled.",
            assertIs<Session.Status.Offline>(session.status.value).message,
        )
    }

    @Test
    fun connectPublishesTheStreamHandleBeforeTheStreamCanClearIt() = runBlocking {
        val scope = CoroutineScope(EagerDispatcher + Job())
        var opens = 0
        val session = Session(
            scope = scope,
            connectionStore = FakeConnectionStore(
                Connection(id = "c1", name = "Mac", host = "127.0.0.1", port = 8810),
            ),
            tokenStore = FakeTokenStore().apply { saved["c1"] = "tok" },
            onboardingStore = InMemoryOnboardingStore(),
            deviceNameProvider = { "Pixel" },
            notificationSink = RecordingNotifications(),
            clientFactory = { connection, token -> CompanionClient(connection, token) },
            pairFn = { _, _, _, _ -> error("pair not expected") },
            eventsFn = { _, _, _ ->
                opens++
                flow { throw APIError.Status(401, "revoked") }
            },
            hydrateFn = { _, _ -> Fleet(emptyList(), emptyList()) },
        )
        session.awaitRestored()

        session.connect()
        assertEquals(1, opens)
        assertEquals(Session.Status.Unauthorized, session.status.value)

        session.connect()
        assertEquals(2, opens)
        scope.cancel()
    }

    private fun kotlinx.coroutines.test.TestScope.session(
        connectionStore: ConnectionStore = FakeConnectionStore(),
        tokenStore: TokenStore = FakeTokenStore(),
        pairFn: suspend (Connection, String, String) -> PairResponse = { _, _, _ -> error("pair not expected") },
        pairOutcomeFn: suspend (Connection, String, String, String) -> PairingOutcome =
            { connection, credential, deviceName, _ ->
                PairingOutcome(pairFn(connection, credential, deviceName), connection)
            },
        events: (String?, Boolean) -> Flow<StreamFrame> = { _, _ -> emptyFlow() },
        hydrate: suspend () -> Fleet = { Fleet(emptyList(), emptyList()) },
        notifications: NotificationSink = RecordingNotifications(),
        clientFactory: (Connection, String?) -> CompanionClient = { connection, token ->
            CompanionClient(connection, token)
        },
        metadata: suspend (CompanionClient) -> CompanionConnectionMetadata = { throw APIError.Status(404) },
    ): Session = Session(
        scope = backgroundScope,
        connectionStore = connectionStore,
        tokenStore = tokenStore,
        onboardingStore = InMemoryOnboardingStore(),
        deviceNameProvider = { "Pixel" },
        notificationSink = notifications,
        clientFactory = clientFactory,
        pairFn = pairOutcomeFn,
        eventsFn = { _, since, screens -> events(since, screens) },
        hydrateFn = { _, _ -> hydrate() },
        metadataFn = metadata,
    )

    private fun roomJson(): String = """{
        "id":"g-new",
        "threadId":"t-new",
        "name":"Launch Team",
        "memberIds":["b1","b2"],
        "defaultResponder":{"kind":"mentions"},
        "bulletin":"",
        "unread":false,
        "createdAt":3
    }""".trimIndent()

    private fun roomTaskJson(threadId: String, title: String): String = """{
        "id":"g-new",
        "threadId":"$threadId",
        "name":"Launch Team",
        "memberIds":["b1","b2"],
        "defaultResponder":{"kind":"mentions"},
        "bulletin":"",
        "unread":false,
        "createdAt":3,
        "tasks":[{"threadId":"$threadId","title":"$title","createdAt":3}],
        "messages":[{"id":"m-$threadId","role":"user","kind":"text","at":3,"text":"$title"}]
    }""".trimIndent()
}

private fun sampleBot(id: String, threadId: String) = Bot(
    id = id,
    threadId = threadId,
    name = "Scout",
    title = "coder",
    description = "",
    notifications = true,
    color = "green",
    unread = false,
    modelSelection = ModelSelection("i", "m"),
    createdAt = 1.0,
)

private class FakeConnectionStore(
    initial: Connection? = null,
) : ConnectionStore {
    var saved: Connection? = initial
    private var registry: ConnectionRegistry? = null
    override suspend fun load(): Connection? = saved
    override suspend fun save(connection: Connection) {
        saved = connection
    }
    override suspend fun clear() {
        saved = null
    }
    override suspend fun loadRegistry(): ConnectionRegistryRestore {
        registry?.let { return ConnectionRegistryRestore(it, migratedLegacyConnection = false) }
        val legacy = saved ?: return ConnectionRegistryRestore(ConnectionRegistry(), migratedLegacyConnection = false)
        return ConnectionRegistryRestore(
            ConnectionRegistry.restoring(listOf(legacy), legacy.id),
            migratedLegacyConnection = true,
        )
    }
    override suspend fun saveRegistry(registry: ConnectionRegistry) {
        this.registry = registry.normalized()
        saved = this.registry?.activeConnection
    }
    override suspend fun clearRegistry() {
        registry = ConnectionRegistry()
        saved = null
    }
}

private class FakeTokenStore : TokenStore {
    val saved = linkedMapOf<String, String>()
    val unavailable = linkedMapOf<String, TokenStore.ReadResult.Unavailable>()

    override suspend fun save(connectionId: String, token: String) {
        saved[connectionId] = token
        unavailable.remove(connectionId)
    }

    override suspend fun read(connectionId: String): TokenStore.ReadResult {
        unavailable[connectionId]?.let { return it }
        val token = saved[connectionId] ?: return TokenStore.ReadResult.Missing
        return TokenStore.ReadResult.Found(token)
    }

    override suspend fun remove(connectionId: String) {
        saved.remove(connectionId)
        unavailable.remove(connectionId)
    }
}

private class ThrowingConnectionStore(private val error: Throwable) : ConnectionStore {
    override suspend fun load(): Connection = throw error
    override suspend fun save(connection: Connection) = throw error
    override suspend fun clear() = throw error
}

private class ThrowingTokenStore(private val error: Throwable) : TokenStore {
    override suspend fun save(connectionId: String, token: String) = throw error
    override suspend fun read(connectionId: String): TokenStore.ReadResult = throw error
    override suspend fun remove(connectionId: String) = throw error
}

private object EagerDispatcher : CoroutineDispatcher() {
    override fun dispatch(context: CoroutineContext, block: Runnable) = block.run()
}

private class RecordingNotifications : NotificationSink {
    val delivered = mutableListOf<Pair<NotificationFrame, Int?>>()
    var lastBadge = 0
        private set
    override fun deliver(notification: NotificationFrame, sequence: Int?, connectionId: String) {
        delivered += notification to sequence
    }
    override fun setBadge(count: Int) {
        lastBadge = count
    }
}
