// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.core

import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.cert.CertificateException
import javax.net.ssl.SSLException
import kotlin.coroutines.cancellation.CancellationException

internal class MissingStreamHelloException : IOException("Lost the connection.")

/** Credentials may upgrade from cleartext to a protected route, but must never downgrade afterward. */
class CandidateRotation(endpoints: List<CompanionEndpoint>) {
    var endpoints: List<CompanionEndpoint> = CompanionEndpoint.automaticCandidates(endpoints)
        private set

    private var index = 0

    val currentEndpoint: CompanionEndpoint? get() = endpoints.getOrNull(index)

    val hosts: List<String> get() = endpoints.map { it.displayAddress }

    val current: String get() = currentEndpoint?.displayAddress.orEmpty()

    val count: Int get() = endpoints.size

    fun advance(): String = advanceEndpoint()?.displayAddress.orEmpty()

    fun advanceEndpoint(): CompanionEndpoint? {
        if (endpoints.isEmpty()) return null
        index = (index + 1) % endpoints.size
        val next = currentEndpoint ?: return null
        if (next.protectsCredentials && endpoints.any { !it.protectsCredentials }) {
            endpoints = endpoints.filter { it.protectsCredentials }
            index = endpoints.indexOfFirst { it.url == next.url }.takeIf { it >= 0 } ?: 0
        }
        return currentEndpoint
    }

    fun advanceEndpoint(after: Throwable): CompanionEndpoint? {
        if (endpoints.size <= 1 || !ConnectionAdvice.shouldTryAnotherRoute(after)) return null
        return advanceEndpoint()
    }

    fun promotedEndpoints(): List<CompanionEndpoint> {
        val winner = endpoints.getOrNull(index) ?: return endpoints
        return listOf(winner) + endpoints.filterIndexed { candidateIndex, _ -> candidateIndex != index }
    }

    fun promoted(): List<String> = promotedEndpoints().map { it.displayAddress }

    companion object {
        // Legacy bare hosts do not imply consent for protected transport; local addresses remain explicit cleartext routes.
        fun ofHosts(hosts: List<String>): CandidateRotation = CandidateRotation(
            hosts.mapIndexedNotNull { position, host ->
                CompanionEndpoint.direct(host, CompanionEndpoint.DEFAULT_COMPANION_PORT, priority = position)
            },
        )
    }
}

enum class ConnectionFailure {
    CANNOT_FIND_HOST,
    CANNOT_CONNECT_TO_HOST,
    TIMED_OUT,
    SECURE_CONNECTION_FAILED,
    NOT_CONNECTED_TO_INTERNET,
    CANCELLED,
    NETWORK_CONNECTION_LOST,
    OTHER,
}

object ConnectionAdvice {
    private val PROXY_GATEWAY_STATUSES = 502..504

    private val TUNNEL_GATEWAY_STATUSES = 520..530

    fun shouldTryAnotherHost(failure: ConnectionFailure): Boolean = failure in setOf(
        ConnectionFailure.CANNOT_FIND_HOST,
        ConnectionFailure.CANNOT_CONNECT_TO_HOST,
        ConnectionFailure.TIMED_OUT,
        ConnectionFailure.SECURE_CONNECTION_FAILED,
    )

    fun shouldTryAnotherHost(error: Throwable): Boolean =
        shouldTryAnotherHost(classify(error))

    /** An ambiguous transport failure is not evidence that a one-time pairing credential was rejected; retries must retain the idempotent request. */
    fun shouldRetryPairingOnAnotherRoute(error: APIError): Boolean = when (error) {
        is APIError.Transport -> true
        is APIError.Status -> isGatewayStatus(error.code)
        APIError.BadUrl -> false
    }

    fun shouldTryAnotherRoute(error: Throwable): Boolean {
        val status = statusCode(error)
        if (status != null) return isGatewayStatus(status)
        return generateSequence(error) { it.cause }.any { it is MissingStreamHelloException } ||
            shouldTryAnotherHost(classify(error))
    }

    fun gatewayStatus(error: Throwable): Int? = statusCode(error)?.takeIf(::isGatewayStatus)

    private fun statusCode(error: Throwable): Int? =
        generateSequence(error) { it.cause }
            .filterIsInstance<APIError.Status>()
            .firstOrNull()
            ?.code

    private fun isGatewayStatus(status: Int): Boolean =
        status in PROXY_GATEWAY_STATUSES || status in TUNNEL_GATEWAY_STATUSES

    fun classify(error: Throwable): ConnectionFailure {
        val chain = generateSequence(error) { it.cause }.toList()
        for (candidate in chain) {
            when (candidate) {
                is CancellationException -> return ConnectionFailure.CANCELLED
                is UnknownHostException -> return ConnectionFailure.CANNOT_FIND_HOST
                is ConnectException -> return ConnectionFailure.CANNOT_CONNECT_TO_HOST
                is SocketTimeoutException -> return ConnectionFailure.TIMED_OUT
                is SSLException -> return ConnectionFailure.SECURE_CONNECTION_FAILED
                // A rejected or untrusted certificate is a property of this route, not of the
                // pairing: another advertised route can repair it.
                is CertificateException -> return ConnectionFailure.SECURE_CONNECTION_FAILED
                is java.net.NoRouteToHostException -> return ConnectionFailure.TIMED_OUT
                is java.net.SocketException -> {
                    val detail = candidate.message.orEmpty().lowercase()
                    if ("network is unreachable" in detail || "no route" in detail) {
                        return ConnectionFailure.TIMED_OUT
                    }
                    if ("connection refused" in detail) {
                        return ConnectionFailure.CANNOT_CONNECT_TO_HOST
                    }
                    if ("reset" in detail || "broken pipe" in detail || "connection abort" in detail) {
                        return ConnectionFailure.NETWORK_CONNECTION_LOST
                    }
                }
            }
        }
        val detail = chain.joinToString(" ") { it.message.orEmpty() }.lowercase()
        return when {
            "unable to resolve host" in detail || "unknown host" in detail ->
                ConnectionFailure.CANNOT_FIND_HOST
            "failed to connect" in detail || "connection refused" in detail ->
                ConnectionFailure.CANNOT_CONNECT_TO_HOST
            "timeout" in detail || "timed out" in detail ->
                ConnectionFailure.TIMED_OUT
            "cleartext" in detail || "ssl" in detail || "tls" in detail ->
                ConnectionFailure.SECURE_CONNECTION_FAILED
            "offline" in detail || "no address associated" in detail ->
                ConnectionFailure.NOT_CONNECTED_TO_INTERNET
            else -> ConnectionFailure.OTHER
        }
    }

    fun message(
        failure: ConnectionFailure,
        host: String,
        port: Int,
        tryingNext: String? = null,
    ): String {
        val advice = when (failure) {
            ConnectionFailure.CANNOT_FIND_HOST ->
                "“$host” didn't resolve. If that's a Tailscale name, this phone may not be on the tailnet."
            ConnectionFailure.CANNOT_CONNECT_TO_HOST ->
                "Reached your computer, but Phone access isn't answering on port $port — open StartupBot → Settings → Phone."
            ConnectionFailure.TIMED_OUT ->
                "No route to your computer at $host — different network, or a firewall."
            ConnectionFailure.NOT_CONNECTED_TO_INTERNET -> "You're offline."
            else -> "Could not reach $host."
        }
        return advice + fallbackAdvice(tryingNext)
    }

    fun message(
        gatewayStatus: Int,
        host: String,
        tryingNext: String? = null,
    ): String = "The route through $host is temporarily unavailable (HTTP $gatewayStatus)." +
        fallbackAdvice(tryingNext)

    fun message(
        error: Throwable,
        host: String,
        port: Int,
        tryingNext: String? = null,
    ): String {
        gatewayStatus(error)?.let { return message(it, host, tryingNext) }
        val failure = classify(error)
        return if (failure == ConnectionFailure.OTHER) {
            error.message?.takeIf { it.isNotBlank() } ?: message(failure, host, port, tryingNext)
        } else {
            message(failure, host, port, tryingNext)
        }
    }

    private fun fallbackAdvice(tryingNext: String?): String =
        tryingNext?.let { " Trying $it next." }.orEmpty() + " The app keeps retrying automatically."
}
