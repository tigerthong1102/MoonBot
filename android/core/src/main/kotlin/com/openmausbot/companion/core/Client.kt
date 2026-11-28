// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.core

import java.io.IOException
import java.net.Inet6Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.URI
import java.net.UnknownHostException
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Dns
import okhttp3.Headers
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.Buffer

internal data class ConnectionEndpoint(val baseUrl: HttpUrl, val dns: Dns)

data class PairingOutcome(
    val response: PairResponse,
    val connection: Connection,
)

class PairingRouteError(val attemptedRoutes: List<String>) : IOException(
    "Couldn't reach this computer through any available route " +
        "(${attemptedRoutes.joinToString()}). Keep Phone access turned on in StartupBot, then try again.",
)

class ServerPairingRetryError(cause: IOException) : IOException(
    if (cause is APIError.Status && cause.code == 429) cause.message
    else "Could not finish connecting to the server. Try again with the same code.", cause,
)

internal const val SCOPED_IPV6_HTTP_HOST = "scoped-ipv6.openmausbot.invalid"

/**
 * OkHttp deliberately rejects RFC 6874 zone identifiers in HttpUrl hosts.
 * A bare IPv6 literal makes OkHttp bypass Dns entirely, so a zoned address
 * uses a private synthetic hostname in HttpUrl. ScopedIpv6Dns maps that name
 * straight to the scoped Inet6Address OkHttp passes to Socket.connect.
 */
internal fun Connection.httpEndpoint(fallbackDns: Dns): ConnectionEndpoint? {
    val dialingEndpoint = activeEndpoint
        ?: CompanionEndpoint.direct(host, port, priority = 0)
        ?: return null
    if (!allowsEndpoint(dialingEndpoint)) return null
    return runCatching {
        val dialingHost = dialingEndpoint.host
        val dialingPort = dialingEndpoint.port
        val dialingScheme = if (dialingEndpoint.isSecure) "https" else "http"
        val bareHost = if (dialingHost.startsWith('[') && dialingHost.endsWith(']')) {
            dialingHost.substring(1, dialingHost.length - 1)
        } else {
            dialingHost
        }
        val zoneAt = if (':' in bareHost) bareHost.indexOf('%') else -1
        require(zoneAt < 0 || zoneAt < bareHost.lastIndex) { "IPv6 zone identifier is empty" }
        val addressHost = if (zoneAt >= 0) bareHost.substring(0, zoneAt) else bareHost
        val httpHost = if (zoneAt >= 0) SCOPED_IPV6_HTTP_HOST else addressHost
        val zone = if (zoneAt >= 0) bareHost.substring(zoneAt + 1) else null
        val url = HttpUrl.Builder()
            .scheme(dialingScheme)
            .host(httpHost)
            .port(dialingPort)
            .build()
        val dns = if (zone == null) {
            fallbackDns
        } else {
            ScopedIpv6Dns(url.host, addressHost, zone, fallbackDns)
        }
        ConnectionEndpoint(url, dns)
    }.getOrNull()
}

internal class ScopedIpv6Dns(
    private val targetHost: String,
    private val addressHost: String,
    private val zone: String,
    private val fallback: Dns,
) : Dns {
    override fun lookup(hostname: String): List<InetAddress> {
        if (!hostname.equals(targetHost, ignoreCase = true)) return fallback.lookup(hostname)
        val unscoped = InetAddress.getByName(addressHost) as? Inet6Address
            ?: throw UnknownHostException("$addressHost is not an IPv6 address")
        val scoped = zone.toIntOrNull()?.let { scopeId ->
            if (scopeId <= 0) throw UnknownHostException("Invalid IPv6 scope id: $zone")
            Inet6Address.getByAddress(addressHost, unscoped.address, scopeId)
        } ?: run {
            val networkInterface = NetworkInterface.getByName(zone)
                ?: throw UnknownHostException("No network interface named $zone")
            Inet6Address.getByAddress(addressHost, unscoped.address, networkInterface)
        }
        return listOf(scoped)
    }
}

class CompanionClient(
    val connection: Connection,
    private val token: String?,
    baseClient: OkHttpClient = OkHttpClient(),
) {
    private val endpoint = connection.httpEndpoint(baseClient.dns)

    private val actionClient = baseClient.newBuilder()
        .followRedirects(baseClient.followRedirects && !connection.pairedWithServer)
        .followSslRedirects(baseClient.followSslRedirects && !connection.pairedWithServer)
        .dns(endpoint?.dns ?: baseClient.dns)
        .callTimeout(ACTION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .connectTimeout(ACTION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .readTimeout(ACTION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .writeTimeout(ACTION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .build()

    private val uploadClient = baseClient.newBuilder()
        .followRedirects(baseClient.followRedirects && !connection.pairedWithServer)
        .followSslRedirects(baseClient.followSslRedirects && !connection.pairedWithServer)
        .dns(endpoint?.dns ?: baseClient.dns)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .connectTimeout(ACTION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .readTimeout(ACTION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .writeTimeout(ACTION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .build()

    private val streamingClient = baseClient.newBuilder()
        .followRedirects(baseClient.followRedirects && !connection.pairedWithServer)
        .followSslRedirects(baseClient.followSslRedirects && !connection.pairedWithServer)
        .dns(endpoint?.dns ?: baseClient.dns)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .connectTimeout(ACTION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .readTimeout(STREAM_IDLE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .writeTimeout(ACTION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .build()

    private val avatarGenerationClient = baseClient.newBuilder()
        .followRedirects(baseClient.followRedirects && !connection.pairedWithServer)
        .followSslRedirects(baseClient.followSslRedirects && !connection.pairedWithServer)
        .dns(endpoint?.dns ?: baseClient.dns)
        .callTimeout(AVATAR_GENERATION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .connectTimeout(AVATAR_GENERATION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .readTimeout(AVATAR_GENERATION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .writeTimeout(AVATAR_GENERATION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .build()

    private val claudeUpdateClient = baseClient.newBuilder()
        .followRedirects(baseClient.followRedirects && !connection.pairedWithServer)
        .followSslRedirects(baseClient.followSslRedirects && !connection.pairedWithServer)
        .dns(endpoint?.dns ?: baseClient.dns)
        .callTimeout(CLAUDE_UPDATE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .connectTimeout(ACTION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .readTimeout(CLAUDE_UPDATE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .writeTimeout(ACTION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .build()

    /** Read identity without sending the saved bearer to a potentially replaced server. */
    suspend fun environment(): ServerEnvironment {
        connection.requireServerTransport()
        val publicClient = CompanionClient(connection, null, actionClient)
        return publicClient.send(
            publicClient.makeRequest("GET", "/.well-known/openmausbot/environment"),
            publicClient.actionClient.newBuilder().followRedirects(false).followSslRedirects(false).build(),
        )
    }

    suspend fun health(): JsonObject = send(makeRequest("GET", "/api/health"))

    suspend fun connectionMetadata(): CompanionConnectionMetadata =
        send(makeRequest("GET", "/api/companion/endpoints"))

    suspend fun fleet(messages: Int? = 50): Fleet = send(makeRequest(
        method = "GET",
        path = "/api/bots",
        query = messages?.let { listOf("messages" to it.toString()) }.orEmpty(),
    ))

    suspend fun messages(threadId: String, before: String? = null, limit: Int = 50): ThreadPage {
        val query = buildList {
            add("limit" to limit.toString())
            before?.let { add("before" to it) }
        }
        return send(makeRequest("GET", "/api/threads/${segment(threadId)}/messages", query))
    }

    suspend fun messagesAround(threadId: String, messageId: String, limit: Int = 50): ThreadPage = send(
        makeRequest(
            "GET",
            "/api/threads/${segment(threadId)}/messages",
            listOf("limit" to limit.toString(), "around" to messageId),
        ),
    )

    suspend fun search(query: String, limit: Int = 40): List<SearchHit> = send<SearchResponse>(
        makeRequest("GET", "/api/search", listOf("q" to query, "limit" to limit.toString())),
    ).hits

    suspend fun export(threadId: String, format: String): TranscriptExport {
        val raw = perform(makeRequest(
            "GET",
            "/api/threads/${segment(threadId)}/export",
            listOf("format" to format),
        ))
        check(raw)
        val fallback = "transcript.${if (format == "json") "json" else "md"}"
        val filename = raw.headers["Content-Disposition"]
            .orEmpty()
            .split(';')
            .map(String::trim)
            .firstOrNull { it.startsWith("filename=", ignoreCase = true) }
            ?.drop("filename=".length)
            ?.trim('"')
            ?: fallback
        return TranscriptExport(
            data = raw.data,
            filename = filename,
            contentType = raw.headers["Content-Type"] ?: "application/octet-stream",
        )
    }

    suspend fun instances(): List<Instance> = send<InstanceList>(
        makeRequest("GET", "/api/instances"),
    ).instances

    suspend fun imageCapableInstanceIds(): Set<String> = instances()
        .filter { it.capabilities?.images == true }
        .mapTo(mutableSetOf(), Instance::instanceId)

    private fun protectedTwinClient(): CompanionClient {
        if (endpoint != null && connection.activeEndpoint?.protectsCredentials == true) return this
        val route = connection.orderedEndpoints.firstOrNull { it.protectsCredentials }
            ?: throw APIError.Transport("Use HTTPS or Tailscale to open AI Twin.")
        return CompanionClient(connection.dialing(route), token, actionClient)
    }

    private fun twinRequestClient(timeout: Long = ACTION_TIMEOUT_SECONDS): OkHttpClient = actionClient.newBuilder()
        .followRedirects(false)
        .followSslRedirects(false)
        .callTimeout(timeout, TimeUnit.SECONDS)
        .readTimeout(timeout, TimeUnit.SECONDS)
        .build()

    suspend fun aiTwin(): AiTwinStatus {
        val client = protectedTwinClient()
        return client.send(client.makeRequest("GET", "/api/ai-twin"), client.twinRequestClient())
    }

    suspend fun askAiTwin(profile: AiTwinProfile, question: String, action: AiTwinAction, provider: AiTwinProvider?): AiTwinAnswer {
        require(action == AiTwinAction.Exact || provider != null)
        val client = protectedTwinClient()
        val body = buildJsonObject {
            put("id", profile.id)
            put("revision", profile.revision)
            put("question", question)
            if (action != AiTwinAction.Exact && provider != null) {
                put("key", provider.key)
                put("useProvider", true)
            }
            if (action == AiTwinAction.Draft) put("useMemory", true)
        }
        val path = if (action == AiTwinAction.Draft) "preview" else "lookup"
        val timeout = when (action) {
            AiTwinAction.Exact -> ACTION_TIMEOUT_SECONDS
            AiTwinAction.Semantic -> 45L
            AiTwinAction.Draft -> 65L
        }
        return client.send(client.makeRequest("POST", "/api/ai-twin/$path", body = body), client.twinRequestClient(timeout))
    }

    suspend fun config(): ConfigStatus = send(makeRequest("GET", "/api/config"))

    // Synthesis-provider selection does not transport provider credentials.
    suspend fun updateVoiceProvider(provider: VoiceProvider): ConfigStatus = send(
        makeRequest(
            "PUT",
            "/api/config",
            body = buildJsonObject {
                put("tts", buildJsonObject { put("provider", provider.wire) })
            },
        ),
    )

    suspend fun connectorCatalog(): ConnectorCatalog =
        send(makeRequest("GET", "/api/connectors/catalog"))

    suspend fun allConnectorStatuses(): ConnectorStatuses =
        send(makeRequest("GET", "/api/connectors/connected"))

    suspend fun image(threadId: String, messageId: String): ByteArray {
        val raw = perform(makeRequest("GET", "/api/threads/${segment(threadId)}/messages/${segment(messageId)}/image"))
        check(raw)
        return raw.data
    }

    /**
     * Fetch an app-owned file mentioned by one transcript message. The path
     * still names the file on the paired computer, so it is sent in an
     * authenticated JSON body rather than placed in the URL. The server
     * verifies both message provenance and its attachment roots.
     */
    suspend fun downloadFile(threadId: String, messageId: String, path: String): DownloadedFile {
        val link = LocalMessageLink.resolve(path) as? LocalMessageLink.DesktopFile ?: throw APIError.BadUrl
        val raw = perform(
            makeRequest(
                "POST",
                "/api/threads/${safeRouteId(threadId)}/messages/${safeRouteId(messageId)}/file",
                body = jsonBody("path" to link.path),
            ),
            maximumBytes = MAXIMUM_FILE_DOWNLOAD_BYTES.toLong(),
        )
        check(raw)
        val declared = raw.headers["Content-Length"]?.trim()?.toLongOrNull() ?: -1L
        if (declared > MAXIMUM_FILE_DOWNLOAD_BYTES || raw.data.size > MAXIMUM_FILE_DOWNLOAD_BYTES) {
            throw APIError.Transport("That file is larger than 25 MB.")
        }
        val rawContentType = raw.headers["Content-Type"].orEmpty()
        val contentType = if (AttachmentPolicy.validMime(rawContentType)) {
            AttachmentPolicy.normalizedMime(rawContentType)
        } else {
            "application/octet-stream"
        }
        return DownloadedFile(
            data = raw.data,
            filename = downloadFilename(raw.headers["Content-Disposition"], link.path),
            contentType = contentType,
        )
    }

    suspend fun avatar(path: String): ByteArray {
        if (!validAvatarPath(path)) throw APIError.BadUrl
        val raw = perform(makeRequest("GET", path))
        check(raw)
        return raw.data
    }

    suspend fun voices(): List<Voice> = send<VoiceListResponse>(
        makeRequest("GET", "/api/tts/voices"),
    ).voices

    suspend fun routines(): RoutinesResponse = send(makeRequest("GET", "/api/routines"))

    suspend fun overview(botId: String): BotOverview =
        send(makeRequest("GET", "/api/bots/${segment(botId)}/overview"))

    suspend fun createBot(): Bot = send<CreatedBot>(makeRequest("POST", "/api/bots")).bot

    suspend fun assignSection(name: String, botIds: List<String>): List<Bot> = send<SidebarSectionResponse>(
        makeRequest(
            "POST",
            "/api/sidebar-sections",
            body = buildJsonObject {
                put("name", name)
                put("botIds", JsonArray(botIds.map(::JsonPrimitive)))
            },
        ),
    ).bots

    suspend fun updateProfile(botId: String, patch: BotProfilePatch): Bot {
        val body = CompanionJson.encodeToJsonElement(BotProfilePatch.serializer(), patch).jsonObject
        return send<BotResponse>(
            makeRequest("PATCH", "/api/bots/${segment(botId)}/profile", body = body),
        ).bot
    }

    suspend fun updateModel(botId: String, selection: ModelSelection, threadId: String? = null): Bot {
        val model = CompanionJson.encodeToJsonElement(ModelSelection.serializer(), selection).jsonObject
        val path = if (threadId == null) "/api/bots/${segment(botId)}/model"
            else "/api/bots/${segment(botId)}/tasks/${segment(threadId)}"
        val body = if (threadId == null) model else buildJsonObject {
            put("modelSelection", model)
            put("requireAvailableModel", true)
        }
        return send<BotResponse>(
            makeRequest("PATCH", path, body = body),
        ).bot
    }

    suspend fun uploadImage(data: ByteArray, mime: String, uploadId: String? = null): String {
        if (!validUploadId(uploadId)) throw APIError.BadUrl
        val normalized = mime.lowercase()
        if (normalized !in AVATAR_MIME_TYPES || data.size > AVATAR_MAX_BYTES) {
            throw APIError.Transport("Choose a PNG, JPEG, GIF, or WebP image up to 10 MB.")
        }
        val saved = send<AttachmentResponse>(
            makeRequest(
                "POST",
                "/api/attachments",
                query = uploadId?.let { listOf("uploadId" to it) }.orEmpty(),
                rawBody = data.toRequestBody(normalized.toMediaType()),
            ),
            uploadClient,
        )
        if (!validUploadedPath(saved.path)) {
            throw APIError.Transport("The uploaded image could not be used.")
        }
        return saved.path
    }

    suspend fun uploadAvatar(data: ByteArray, mime: String): String {
        val path = uploadImage(data, mime)
        val name = path.substringAfterLast('/')
        if (name.isEmpty() || '/' in name) throw APIError.Transport("The uploaded image could not be used.")
        return "/api/attachments/$name"
    }

    suspend fun uploadFile(data: ByteArray, name: String, mime: String, uploadId: String? = null): UploadedFile {
        if (!validUploadId(uploadId)) throw APIError.BadUrl
        val displayName = name.substringAfterLast('/').substringAfterLast('\\').trim()
        val normalized = mime.lowercase()
        if (
            displayName.isEmpty() || displayName.toByteArray().size > 255 ||
            !validUploadMime(normalized) || data.size > SHARE_FILE_MAX_BYTES
        ) throw APIError.Transport("Choose a file up to 25 MB with a valid filename.")
        val saved = send<FileUploadResponse>(
            makeRequest(
                "POST",
                "/api/files",
                query = buildList {
                    add("name" to displayName)
                    uploadId?.let { add("uploadId" to it) }
                },
                rawBody = data.toRequestBody(normalized.toMediaType()),
            ),
            uploadClient,
        )
        val returnedName = saved.name.trim()
        if (!validUploadedPath(saved.path) || !validUploadedName(returnedName)) {
            throw APIError.Transport("The uploaded file could not be used.")
        }
        return UploadedFile(saved.path, returnedName)
    }

    suspend fun generateAvatar(botId: String, prompt: String): Bot =
        send<GeneratedAvatarResponse>(
            makeRequest(
                "POST",
                "/api/bots/${segment(botId)}/avatar/generate",
                body = jsonBody("prompt" to prompt.take(400)),
            ),
            avatarGenerationClient,
        ).bot

    suspend fun updateClaude(instanceId: String): String {
        if (!isSafeInstanceId(instanceId)) throw APIError.BadUrl
        return send<ClaudeUpdateResponse>(
            makeRequest(
                "POST",
                "/api/instances/$instanceId/claude-update",
                body = JsonObject(emptyMap()),
            ),
            claudeUpdateClient,
        ).version
    }

    suspend fun previewVoice(text: String, voiceId: String): ByteArray = speak(text, voiceId)

    suspend fun speak(text: String, voiceId: String?): ByteArray {
        val raw = perform(makeRequest(
            "POST",
            "/api/tts/speak",
            body = buildJsonObject {
                put("text", text.take(500))
                if (!voiceId.isNullOrEmpty()) put("voiceId", voiceId)
            },
        ))
        check(raw)
        return raw.data
    }

    suspend fun prepareSpeech(text: String, voiceId: String?): PreparedSpeech = send(
        makeRequest(
            "POST",
            "/api/tts/prepare",
            body = buildJsonObject {
                put("text", text)
                if (!voiceId.isNullOrEmpty()) put("voiceId", voiceId)
            },
        ),
    )

    suspend fun updateVoiceKey(key: String) {
        if (endpoint?.baseUrl?.isHttps != true) {
            throw APIError.Transport("API keys require HTTPS. Set up the voice key on your computer.")
        }
        val trimmed = key.trim()
        if (trimmed.toByteArray().size > 512 || trimmed.any(Char::isISOControl)) {
            throw APIError.Transport("That doesn't look like an API key.")
        }
        sendUnit(makeRequest("PUT", "/api/config", body = buildJsonObject {
            put("tts", buildJsonObject { put("key", trimmed) })
        }))
    }

    suspend fun updateVoiceProvider(provider: String) {
        sendUnit(makeRequest("PUT", "/api/config", body = buildJsonObject {
            put("tts", buildJsonObject { put("provider", provider) })
        }))
    }

    suspend fun createRoutine(input: RoutineInput): Routine {
        requireSupported(input.schedule)
        requireValidTimeout(input.timeoutMinutes)
        return send<RoutineResponse>(
            makeRequest("POST", "/api/routines", body = routineBody(input)),
        ).routine
    }

    suspend fun updateRoutine(id: String, input: RoutineInput): Routine {
        requireSupported(input.schedule)
        requireValidTimeout(input.timeoutMinutes)
        return send<RoutineResponse>(
            makeRequest("PATCH", "/api/routines/${segment(id)}", body = routineBody(input)),
        ).routine
    }

    suspend fun setRoutineEnabled(id: String, enabled: Boolean): Routine =
        send<RoutineResponse>(
            makeRequest("PATCH", "/api/routines/${segment(id)}", body = buildJsonObject { put("enabled", enabled) }),
        ).routine

    suspend fun runRoutine(id: String): RoutineRun = send<RoutineRunResponse>(
        makeRequest("POST", "/api/routines/${segment(id)}/run"),
    ).run

    suspend fun deleteRoutine(id: String) {
        sendUnit(makeRequest("DELETE", "/api/routines/${segment(id)}"))
    }

    suspend fun createRoom(name: String?, memberIds: List<String>): Room {
        val body = buildJsonObject {
            put("memberIds", JsonArray(memberIds.map(::JsonPrimitive)))
            name?.let { value ->
                val trimmed = value.trim { character ->
                    character == '\t' || character.category == CharCategory.SPACE_SEPARATOR
                }
                if (trimmed.isNotEmpty()) put("name", value)
            }
        }
        return send<CreatedRoom>(makeRequest("POST", "/api/groups", body = body)).group
    }

    suspend fun sendToBot(botId: String, text: String, threadId: String? = null): SendReceipt =
        sendForReceipt(
            makeRequest("POST", "/api/bots/${segment(botId)}/messages", body = jsonBody("text" to text, "threadId" to threadId)),
        )

    suspend fun sendToRoom(groupId: String, text: String, threadId: String? = null): SendReceipt =
        sendForReceipt(
            makeRequest("POST", "/api/groups/${segment(groupId)}/messages", body = jsonBody("text" to text, "threadId" to threadId)),
        )

    suspend fun cancelQueued(queueId: String, to: MessageDestination): Boolean {
        if (!isSafeRouteId(queueId)) throw APIError.BadUrl
        val route = when (to) {
            is MessageDestination.Bot -> "/api/bots/${safeRouteId(to.id)}/queue/$queueId"
            is MessageDestination.Room -> "/api/groups/${safeRouteId(to.id)}/queue/$queueId"
        }
        try {
            sendUnit(makeRequest("DELETE", route, body = jsonBody("threadId" to to.threadId)))
            return true
        } catch (error: APIError.Status) {
            if (error.code != 404) throw error
            if (error.serverMessage?.contains(ALREADY_DRAINED, ignoreCase = true) == true) return false
            throw APIError.Status(
                404,
                "This computer is too old to take back a queued message. Update StartupBot on it.",
            )
        }
    }

    suspend fun send(text: String, to: MessageDestination, sendId: String): SendReceipt {
        val route = when (to) {
            is MessageDestination.Bot -> "/api/bots/${safeRouteId(to.id)}/messages"
            is MessageDestination.Room -> "/api/groups/${safeRouteId(to.id)}/messages"
        }
        if (!isSafeRouteId(to.threadId) || !isSafeSendId(sendId)) throw APIError.BadUrl
        return sendForReceipt(makeRequest(
            "POST",
            route,
            body = buildJsonObject {
                put("text", text)
                put("threadId", to.threadId)
                put("sendId", sendId)
            },
        ))
    }

    suspend fun respond(
        threadId: String,
        requestId: String,
        behavior: String,
        message: String? = null,
        reviewedSha256: String? = null,
    ) {
        val body = buildJsonObject {
            put("requestId", requestId)
            put("behavior", behavior)
            message?.let { put("message", it) }
            reviewedSha256?.let { put("reviewedSha256", it) }
        }
        sendUnit(makeRequest("POST", "/api/threads/${segment(threadId)}/respond", body = body))
    }

    suspend fun alwaysAllow(botId: String, key: String, threadId: String? = null) {
        sendUnit(makeRequest("POST", "/api/bots/${segment(botId)}/always-allow", body = jsonBody("allowKey" to key, "threadId" to threadId)))
    }

    suspend fun authorizeConnector(slug: String, alias: String?): URI {
        if (!validConnectorSlug(slug)) throw APIError.BadUrl
        val body = ConnectedAppsRules.trimmedAlias(alias)?.let { jsonBody("alias" to it) }
        val response = send<ConnectorAuthorizationResponse>(makeRequest(
            "POST",
            "/api/connectors/$slug/authorize",
            body = body,
        ))
        val url = runCatching { URI(response.url) }.getOrNull()
        if (url == null || !url.scheme.equals("https", ignoreCase = true) || url.host.isNullOrEmpty()) {
            throw APIError.BadUrl
        }
        return url
    }

    suspend fun toggleReaction(threadId: String, messageId: String, emoji: String): Message =
        send<MessageResponse>(makeRequest(
            "POST",
            "/api/threads/${segment(threadId)}/messages/${segment(messageId)}/reactions",
            body = jsonBody("emoji" to emoji),
        )).message

    suspend fun edit(
        botId: String,
        messageId: String,
        text: String,
        threadId: String? = null,
        sendId: String? = null,
    ): Message? {
        val raw = perform(makeRequest(
            "POST",
            "/api/bots/${segment(botId)}/messages/${segment(messageId)}/edit",
            body = jsonBody("text" to text, "threadId" to threadId, "sendId" to sendId),
        ))
        check(raw)
        return runCatching {
            CompanionJson.decodeFromString<EditResponse>(raw.data.toString(Charsets.UTF_8)).message
        }.getOrNull()
    }

    suspend fun setActiveBranch(botId: String, messageId: String, threadId: String? = null): String =
        send<ActiveBranchResponse>(makeRequest(
            "POST",
            "/api/bots/${segment(botId)}/active-branch",
            body = jsonBody("messageId" to messageId, "threadId" to threadId),
        )).activeLeafId

    suspend fun createTask(botId: String, title: String? = null): Bot {
        val body = buildJsonObject {
            title?.takeIf(String::isNotEmpty)?.let { put("title", it) }
        }
        return send<BotResponse>(makeRequest("POST", "/api/bots/${segment(botId)}/tasks", body = body)).bot
    }

    suspend fun switchTask(botId: String, threadId: String): Bot = send<BotResponse>(
        makeRequest("POST", "/api/bots/${segment(botId)}/tasks/${segment(threadId)}"),
    ).bot

    suspend fun renameTask(botId: String, threadId: String, title: String) {
        sendUnit(makeRequest(
            "PATCH",
            "/api/bots/${segment(botId)}/tasks/${segment(threadId)}",
            body = jsonBody("title" to title),
        ))
    }

    suspend fun snoozeTask(botId: String, threadId: String, snoozedUntil: Long?) {
        sendUnit(makeRequest(
            "PATCH",
            "/api/bots/${segment(botId)}/tasks/${segment(threadId)}",
            body = buildJsonObject { put("snoozedUntil", JsonPrimitive(snoozedUntil)) },
        ))
    }

    suspend fun setTaskPinned(botId: String, threadId: String, pinned: Boolean) {
        sendUnit(makeRequest(
            "PATCH",
            "/api/bots/${segment(botId)}/tasks/${segment(threadId)}",
            body = buildJsonObject { put("pinned", pinned) },
        ))
    }

    suspend fun setRoomTaskPinned(groupId: String, threadId: String, pinned: Boolean, title: String) {
        sendUnit(makeRequest(
            "PATCH",
            "/api/groups/${segment(groupId)}/tasks/${segment(threadId)}",
            body = buildJsonObject {
                put("pinned", pinned)
                put("title", title)
            },
        ))
    }

    suspend fun setTaskArchived(botId: String, threadId: String, archivedAt: Double?) {
        sendUnit(makeRequest(
            "PATCH",
            "/api/bots/${segment(botId)}/tasks/${segment(threadId)}",
            body = buildJsonObject { put("archivedAt", JsonPrimitive(archivedAt?.toLong())) },
        ))
    }

    suspend fun deleteTask(botId: String, threadId: String): Bot = send<BotResponse>(
        makeRequest("DELETE", "/api/bots/${segment(botId)}/tasks/${segment(threadId)}"),
    ).bot

    suspend fun createRoomTask(groupId: String, title: String? = null): Room {
        val body = buildJsonObject {
            title?.takeIf(String::isNotEmpty)?.let { put("title", it) }
        }
        return send<RoomResponse>(
            makeRequest("POST", "/api/groups/${segment(groupId)}/tasks", body = body),
        ).group
    }

    suspend fun switchRoomTask(groupId: String, threadId: String): Room = send<RoomResponse>(
        makeRequest("POST", "/api/groups/${segment(groupId)}/tasks/${segment(threadId)}"),
    ).group

    suspend fun renameRoomTask(groupId: String, threadId: String, title: String) {
        sendUnit(makeRequest(
            "PATCH",
            "/api/groups/${segment(groupId)}/tasks/${segment(threadId)}",
            body = jsonBody("title" to title),
        ))
    }

    suspend fun deleteRoomTask(groupId: String, threadId: String): Room = send<RoomResponse>(
        makeRequest("DELETE", "/api/groups/${segment(groupId)}/tasks/${segment(threadId)}"),
    ).group

    suspend fun interrupt(botId: String, threadId: String? = null) {
        sendUnit(makeRequest("POST", "/api/bots/${segment(botId)}/interrupt", body = jsonBody("threadId" to threadId)))
    }

    suspend fun cloudDesktop(botId: String): CloudDesktopSession = send(
        makeRequest("POST", "/api/bots/${segment(botId)}/computer/join"),
    )

    suspend fun markBotRead(botId: String, threadId: String? = null) {
        sendUnit(makeRequest("POST", "/api/bots/${segment(botId)}/read", body = jsonBody("threadId" to threadId)))
    }

    suspend fun markRoomRead(roomId: String, threadId: String? = null) {
        sendUnit(makeRequest("POST", "/api/groups/${segment(roomId)}/read", body = jsonBody("threadId" to threadId)))
    }

    @Serializable
    data class MobileLogin(val token: String, val environment: ServerEnvironment, val connectionId: String)

    private fun mobileRequest(path: String, body: JsonObject): Request {
        val origin = requireNotNull(connection.activeEndpoint?.url)
        require(token == null && origin.startsWith("https://"))
        return makeRequest("POST", path, body = body).newBuilder().header("Origin", origin).header("X-StartupBot-Client", "companion").build()
    }

    @Serializable
    data class MobileCodeResponse(val desktopHandoff: Boolean)

    suspend fun requestMobileCode(email: String): MobileCodeResponse {
        val request = mobileRequest("/mobile/code", jsonBody("client" to "companion", "email" to email))
        return send(request, mobileLoginClient())
    }

    suspend fun mobileLogin(email: String, code: String, allowDrafts: Boolean): MobileLogin = send(
        mobileRequest("/mobile/login", jsonBody("client" to "companion", "email" to email, "otp" to code,
            "desktopDrafts" to if (allowDrafts) "allow" else "deny")),
        mobileLoginClient(),
    )

    private fun mobileLoginClient() = actionClient.newBuilder().followRedirects(false).followSslRedirects(false).build()

    fun events(since: String?, screens: Boolean = false): Flow<StreamFrame> {
        val query = buildList {
            add("screens" to if (screens) "on" else "off")
            since?.let { add("since" to it) }
        }
        val request = makeRequest("GET", "/api/events", query).newBuilder()
            .header("Accept", "text/event-stream")
            .build()
        return eventStream(request, streamingClient)
    }

    private fun makeRequest(
        method: String,
        path: String,
        query: List<Pair<String, String>> = emptyList(),
        body: JsonObject? = null,
        rawBody: RequestBody? = null,
    ): Request {
        require(body == null || rawBody == null)
        if (connection.pairedWithServer) connection.requireServerTransport()
        val base = endpoint?.baseUrl ?: throw APIError.BadUrl
        if (token?.startsWith("sb_mobile_") == true) {
            require(base.isHttps && connection.serverEnvironmentId == "startupbot-mobile:" + base.toString().trimEnd('/'))
        }
        val url = base.newBuilder().encodedPath(path).apply {
            query.forEach { (name, value) -> addQueryParameter(name, value) }
        }.build()
        val requestBody = when {
            rawBody != null -> rawBody
            body != null -> CompanionJson.encodeToString(JsonObject.serializer(), body)
                .toRequestBody(JSON_MEDIA_TYPE)
            method == "POST" || method == "PATCH" -> EMPTY_BODY
            else -> null
        }
        return Request.Builder()
            .url(url)
            .method(method, requestBody)
            .apply { token?.let { header("Authorization", "Bearer $it") } }
            .build()
    }

    private suspend inline fun <reified T> send(
        request: Request,
        requestClient: OkHttpClient = actionClient,
    ): T {
        val raw = perform(request, requestClient)
        check(raw)
        return try {
            CompanionJson.decodeFromString(raw.data.toString(Charsets.UTF_8))
        } catch (error: SerializationException) {
            throw APIError.Transport("The computer sent something this app couldn't read.", error)
        }
    }

    private suspend fun sendUnit(request: Request) {
        val raw = perform(request)
        check(raw)
    }

    private suspend fun sendForReceipt(request: Request): SendReceipt {
        val client = if (token?.startsWith("sb_mobile_") == true) {
            actionClient.newBuilder().callTimeout(120, TimeUnit.SECONDS).readTimeout(120, TimeUnit.SECONDS).build()
        } else actionClient
        val raw = perform(request, client)
        check(raw)
        return try {
            CompanionJson
                .decodeFromString<SendReceiptBody>(raw.data.toString(Charsets.UTF_8))
                .receipt()
        } catch (_: SerializationException) {
            SendReceipt.Sent(threadId = null, steered = false)
        }
    }

    /** Every authenticated action, including shares to inactive saved servers, checks identity. */
    private suspend fun perform(
        request: Request,
        requestClient: OkHttpClient = actionClient,
        maximumBytes: Long = MAXIMUM_RESPONSE_BYTES,
    ): RawResponse {
        if (token != null && connection.serverEnvironmentId != null &&
            environment().environmentId != connection.serverEnvironmentId
        ) {
            throw APIError.Status(401, "This address belongs to a different server. Pair again to continue.")
        }
        return performUnchecked(request, requestClient, maximumBytes)
    }

    private suspend fun performUnchecked(
        request: Request,
        requestClient: OkHttpClient = actionClient,
        maximumBytes: Long = MAXIMUM_RESPONSE_BYTES,
    ): RawResponse = suspendCancellableCoroutine { continuation ->
        val call = requestClient.newCall(request)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (continuation.isActive) {
                    continuation.resumeWithException(
                        APIError.Transport(e.message ?: "Could not reach the computer.", e),
                    )
                }
            }

            override fun onResponse(call: Call, response: Response) {
                try {
                    response.use {
                        val result = RawResponse(
                            code = response.code,
                            headers = response.headers,
                            data = readBounded(response, maximumBytes),
                        )
                        if (continuation.isActive) continuation.resume(result)
                    }
                } catch (error: IOException) {
                    if (continuation.isActive) {
                        continuation.resumeWithException(
                            APIError.Transport(error.message ?: "Could not reach the computer.", error),
                        )
                    }
                }
            }
        })
    }

    private fun readBounded(response: Response, maximumBytes: Long): ByteArray {
        val body = response.body ?: return ByteArray(0)
        val message = if (maximumBytes == MAXIMUM_FILE_DOWNLOAD_BYTES.toLong()) "That file is larger than 25 MB."
            else "The response exceeds this phone's safety limit."
        if (body.contentLength() > maximumBytes) throw IOException(message)
        val buffer = Buffer()
        val source = body.source()
        while (source.read(buffer, minOf(8192L, maximumBytes + 1 - buffer.size)) != -1L) {
            if (buffer.size > maximumBytes) throw IOException(message)
        }
        return buffer.readByteArray()
    }

    private fun check(response: RawResponse) {
        if (response.code in 200..299) return
        val message = runCatching {
            CompanionJson.decodeFromString<APIErrorBody>(response.data.toString(Charsets.UTF_8)).error
        }.getOrNull()
        throw APIError.Status(response.code, message)
    }

    private data class RawResponse(val code: Int, val headers: Headers, val data: ByteArray)

    companion object {
        const val ALREADY_DRAINED = "no such queued message"

        private const val MAXIMUM_RESPONSE_BYTES = 64L * 1024 * 1024
        private const val ACTION_TIMEOUT_SECONDS = 20L
        private const val AVATAR_GENERATION_TIMEOUT_SECONDS = 150L
        private const val CLAUDE_UPDATE_TIMEOUT_SECONDS = 200L
        private const val STREAM_IDLE_TIMEOUT_SECONDS = 90L
        private const val AVATAR_MAX_BYTES = 10 * 1_024 * 1_024
        const val SHARE_FILE_MAX_BYTES = 25 * 1_024 * 1_024
        const val MAXIMUM_FILE_DOWNLOAD_BYTES = AttachmentPolicy.MAXIMUM_FILE_BYTES

        internal fun downloadFilename(disposition: String?, fallbackPath: String): String {
            val parameters = disposition.orEmpty().split(';').map(String::trim)
            val encoded = parameters.firstOrNull { it.startsWith("filename*=", ignoreCase = true) }
                ?.drop("filename*=".length)
            val ordinary = parameters.firstOrNull { it.startsWith("filename=", ignoreCase = true) }
                ?.drop("filename=".length)
            val decodedEncoded = encoded?.let { value ->
                val unquoted = value.trim('"')
                val payload = unquoted.split('\'', limit = 3)
                val encodedValue = if (payload.size == 3) payload[2] else unquoted
                runCatching { java.net.URLDecoder.decode(encodedValue.replace("+", "%2B"), "UTF-8") }.getOrNull()
            }
            val candidate = decodedEncoded
                ?: ordinary?.trim('"')
                ?: fallbackPath.split('/', '\\').lastOrNull { it.isNotEmpty() }
                ?: "file"
            return sanitisePortableFilename(candidate, "file")
        }
        private val AVATAR_MIME_TYPES = setOf("image/png", "image/jpeg", "image/gif", "image/webp")
        private val JSON_MEDIA_TYPE = "application/json".toMediaType()
        private val EMPTY_BODY: RequestBody = ByteArray(0).toRequestBody(null)
        private const val HEX_DIGITS = "0123456789ABCDEF"

        private fun segment(value: String): String {
            if (value.isEmpty() || value == "." || value == "..") throw APIError.BadUrl
            val escaped = StringBuilder(value.length)
            for (byte in value.toByteArray(Charsets.UTF_8)) {
                val code = byte.toInt() and 0xFF
                val character = code.toChar()
                val unreserved = character in '0'..'9' ||
                    character in 'A'..'Z' ||
                    character in 'a'..'z' ||
                    character == '-' ||
                    character == '.' ||
                    character == '_' ||
                    character == '~'
                if (unreserved) {
                    escaped.append(character)
                } else {
                    escaped.append('%')
                        .append(HEX_DIGITS[code shr 4])
                        .append(HEX_DIGITS[code and 0x0F])
                }
            }
            return escaped.toString()
        }

        private fun validAvatarPath(path: String): Boolean {
            val prefix = "/api/attachments/"
            if (!path.startsWith(prefix)) return false
            val name = path.removePrefix(prefix)
            val dot = name.lastIndexOf('.')
            if (dot <= 0) return false
            val stem = name.substring(0, dot)
            val extension = name.substring(dot + 1)
            return stem.all { it in '0'..'9' || it in 'A'..'Z' || it in 'a'..'z' || it == '-' } &&
                extension in setOf("png", "jpg", "gif", "webp")
        }

        private fun validUploadMime(value: String): Boolean =
            value.isNotEmpty() && value.toByteArray().size <= 127 && '/' in value && value.all {
                it.isLetterOrDigit() || it in "!#$&+-. /^_".filterNot(Char::isWhitespace)
            }

        private fun validUploadId(value: String?): Boolean = value == null || runCatching {
            UUID.fromString(value).toString().equals(value, ignoreCase = true)
        }.getOrDefault(false)

        private fun validUploadedPath(value: String): Boolean =
            value.isNotEmpty() && value.toByteArray().size <= 4_096 && '\u0000' !in value

        private fun validUploadedName(value: String): Boolean =
            value.isNotEmpty() && value.toByteArray().size <= 255 && '/' !in value && '\\' !in value &&
                value.none(Char::isISOControl)

        private fun isSafeRouteId(value: String): Boolean =
            value.isNotEmpty() && value.all { it.isLetterOrDigit() || it == '-' || it == '_' }

        private fun safeRouteId(value: String): String = if (isSafeRouteId(value)) value else throw APIError.BadUrl

        private fun isSafeInstanceId(value: String): Boolean =
            value != "." && value != ".." && INSTANCE_ID.matches(value)

        private val INSTANCE_ID = Regex("^[A-Za-z0-9_.-]+$")

        private fun isSafeSendId(value: String): Boolean = value.length in 16..80 && isSafeRouteId(value)

        private fun validConnectorSlug(value: String): Boolean =
            value.isNotEmpty() && value.all {
                it in '0'..'9' || it in 'A'..'Z' || it in 'a'..'z' || it == '_' || it == '-'
            }

        private fun requireSupported(schedule: RoutineSchedule) {
            if (schedule.type == RoutineSchedule.Kind.UNKNOWN) {
                throw APIError.Transport("Choose a supported schedule before saving this routine.")
            }
            if (
                schedule.type == RoutineSchedule.Kind.INTERVAL &&
                ((schedule.everyMinutes ?: 0) !in 5..1_440 || schedule.anchorAt == null)
            ) {
                throw APIError.Transport(
                    "Choose an interval from 5 to 1,440 minutes and an alignment time.",
                )
            }
        }

        private fun requireValidTimeout(timeoutMinutes: Int?) {
            if (timeoutMinutes != null && timeoutMinutes !in 5..240) {
                throw APIError.Transport("Choose no timeout or a whole number from 5 to 240 minutes.")
            }
        }

        private fun routineBody(input: RoutineInput): JsonObject = buildJsonObject {
            put("name", input.name)
            put("prompt", input.prompt)
            put("botId", input.botId)
            put("runOn", input.runOn)
            input.enabled?.let { put("enabled", it) }
            put("schedule", buildJsonObject {
                put("type", input.schedule.type.name.lowercase())
                input.schedule.at?.let { put("at", it) }
                input.schedule.time?.let { put("time", it) }
                input.schedule.weekdays?.let { days ->
                    put("weekdays", JsonArray(days.map(::JsonPrimitive)))
                }
                input.schedule.everyMinutes?.let { put("everyMinutes", it) }
                input.schedule.anchorAt?.let { put("anchorAt", it) }
            })
            put("durationMinutes", input.durationMinutes)
            if (input.timeoutMinutes != null) put("timeoutMinutes", input.timeoutMinutes)
            else if (input.clearTimeout) put("timeoutMinutes", JsonNull)
        }

        suspend fun pairWithServer(
            connection: Connection,
            code: String,
            label: String,
            attemptId: String,
            client: OkHttpClient = OkHttpClient(),
        ): ServerPairResponse {
            connection.requireServerTransport()
            val companion = CompanionClient(connection, token = null, baseClient = client)
            val pairClient = client.newBuilder()
                .dns(companion.endpoint?.dns ?: client.dns)
                .followRedirects(false)
                .followSslRedirects(false)
                .callTimeout(PAIR_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .connectTimeout(PAIR_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .readTimeout(PAIR_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .writeTimeout(PAIR_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .build()
            return companion.send(companion.makeRequest(
                "POST", "/api/auth/pair",
                body = jsonBody("code" to code, "label" to label, "attemptId" to attemptId),
            ), pairClient)
        }

        suspend fun pair(
            connection: Connection,
            credential: String,
            deviceName: String,
            pairRequestId: String? = null,
            client: OkHttpClient = OkHttpClient(),
        ): PairResponse {
            val field = if (credential.length == 6 && credential.all { it in '0'..'9' }) {
                "code"
            } else {
                "credential"
            }
            val companion = CompanionClient(connection, token = null, baseClient = client)
            val body = buildList {
                add(field to credential)
                add("deviceName" to deviceName)
                pairRequestId?.let { add("pairRequestId" to it) }
            }
            val pairClient = client.newBuilder()
                .dns(companion.endpoint?.dns ?: client.dns)
                .callTimeout(PAIR_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .connectTimeout(PAIR_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .readTimeout(PAIR_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .writeTimeout(PAIR_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .build()
            return companion.send(companion.makeRequest(
                "POST",
                "/api/pair",
                body = jsonBody(*body.toTypedArray()),
            ), pairClient)
        }

        /**
         * Source-compatible entry point for callers written before request ids existed.
         *
         * This overload sends the credential directly to [connection], without a health/identity
         * preflight or request id. It is not safe for new multi-route pairing invitations; those
         * callers must use [pairFirstReachable].
         */
        suspend fun pair(
            connection: Connection,
            credential: String,
            deviceName: String,
            client: OkHttpClient,
        ): PairResponse = pair(
            connection,
            credential,
            deviceName,
            pairRequestId = null,
            client = client,
        )

        /**
         * Identify every automatically permitted route before presenting the one-time credential.
         * Probes run together, but the advertised order wins rather than response speed.
         */
        suspend fun pairFirstReachable(
            connection: Connection,
            credential: String,
            deviceName: String,
            pairRequestId: String = UUID.randomUUID().toString(),
            client: OkHttpClient = OkHttpClient(),
        ): PairingOutcome {
            val endpoints = connection.automaticEndpoints
            val attemptedRoutes = endpoints.map(CompanionEndpoint::url)
            val remaining = endpoints.map(connection::dialing).toMutableList()

            while (remaining.isNotEmpty()) {
                val winnerIndex = firstHealthy(remaining, client)
                    ?: throw PairingRouteError(attemptedRoutes)
                val winner = remaining.removeAt(winnerIndex)
                try {
                    val response = pair(
                        connection = winner,
                        credential = credential,
                        deviceName = deviceName,
                        pairRequestId = pairRequestId,
                        client = client,
                    )
                    return PairingOutcome(response, winner)
                } catch (error: CancellationException) {
                    throw error
                } catch (error: APIError) {
                    if (ConnectionAdvice.shouldRetryPairingOnAnotherRoute(error)) continue
                    throw error
                } catch (_: Exception) {
                    continue
                }
            }
            throw PairingRouteError(attemptedRoutes)
        }

        private suspend fun firstHealthy(
            candidates: List<Connection>,
            client: OkHttpClient,
        ): Int? = coroutineScope {
            val probes = candidates.map { candidate ->
                async { healthy(candidate, client) }
            }
            try {
                for (index in probes.indices) {
                    if (probes[index].await()) {
                        probes.forEachIndexed { offset, probe ->
                            if (offset != index) probe.cancel()
                        }
                        return@coroutineScope index
                    }
                }
                null
            } finally {
                probes.forEach { it.cancel() }
            }
        }

        private suspend fun healthy(connection: Connection, client: OkHttpClient): Boolean {
            val companion = CompanionClient(connection, token = null, baseClient = client)
            val probeClient = client.newBuilder()
                .dns(companion.endpoint?.dns ?: client.dns)
                .callTimeout(PROBE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .connectTimeout(PROBE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .readTimeout(PROBE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .writeTimeout(PROBE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .build()
            return try {
                val identity = companion.send<HealthIdentity>(
                    companion.makeRequest("GET", "/api/health"),
                    probeClient,
                )
                identity.app == "openmausbot"
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                false
            }
        }

        @Serializable
        private data class HealthIdentity(val app: String)

        private fun jsonBody(vararg values: Pair<String, String?>): JsonObject = buildJsonObject {
            values.forEach { (name, value) -> value?.let { put(name, it) } }
        }

        private const val PROBE_TIMEOUT_SECONDS = 4L
        private const val PAIR_TIMEOUT_SECONDS = 8L
    }
}
