// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.discovery

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import androidx.annotation.RequiresApi
import com.openmausbot.companion.core.Connection
import java.net.InetAddress
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

data class DiscoveredService(
    val name: String,
    val host: String?,
    val port: Int?,
) {
    val id: String get() = name
}


fun DiscoveredService.toConnection(): Connection? {
    val resolvedHost = host ?: return null
    val resolvedPort = port ?: return null
    return Connection(name = name, host = Connection.urlHost(resolvedHost), port = resolvedPort)
}

/**
 * Discovery surface for the UI. Distinguishes "still looking", "looked and
 * found nothing", and "permission/policy failure" — NsdManager's silent empty
 * list is the Android twin of the iOS Bonjour Info.plist footgun (§19).
 */
sealed interface DiscoveryState {
    data object Idle : DiscoveryState
    data class Active(
        val browsing: Boolean,
        val found: List<DiscoveredService>,
        val failure: String? = null,
        val emptyWhileBrowsing: Boolean = false,
    ) : DiscoveryState
}

internal object DiscoveryRetry {
    const val MAX_ATTEMPTS = 3
    const val BASE_DELAY_MILLIS = 350L

    const val RETRYING = "Local discovery was interrupted. Retrying…"

    fun isRecoverable(errorCode: Int): Boolean = errorCode == NsdManager.FAILURE_MAX_LIMIT

    fun canRetry(attemptsSoFar: Int, errorCode: Int): Boolean =
        isRecoverable(errorCode) && attemptsSoFar < MAX_ATTEMPTS

    fun delayFor(attempt: Int): Long = BASE_DELAY_MILLIS * attempt
}


internal object ResolveRetry {
    const val MAX_ATTEMPTS = 2
    const val DELAY_MILLIS = 350L

    fun canRetry(attemptsSoFar: Int): Boolean = attemptsSoFar < MAX_ATTEMPTS
}

/**
 * Multicast lock held only while an NSD browse is actually active.
 * [releaseIfHeld] is idempotent so terminal failure + [awaitClose] cannot
 * double-release.
 */
internal interface MulticastLockHandle {
    val isHeld: Boolean
    fun releaseIfHeld()
}

internal fun WifiManager.MulticastLock.asHandle(): MulticastLockHandle =
    object : MulticastLockHandle {
        override val isHeld: Boolean
            get() = this@asHandle.isHeld

        override fun releaseIfHeld() {
            runCatching {
                if (this@asHandle.isHeld) release()
            }
        }
    }

internal fun browseDiscoveryFlow(
    serviceType: String,
    acquireMulticastLock: () -> MulticastLockHandle?,
    startBrowse: (NsdManager.DiscoveryListener) -> Unit,
    stopBrowse: (NsdManager.DiscoveryListener) -> Unit,
    resolveService: (NsdServiceInfo, (NsdServiceInfo?) -> Unit) -> Unit,
    /** Android API 34 NSD resolves are registrations that require explicit release. */
    stopResolves: () -> Unit = {},
    hostAddress: (NsdServiceInfo) -> String?,
    failureMessage: (Int) -> String,
): Flow<DiscoveryState> = callbackFlow {
    val multicastLock = acquireMulticastLock()
    val resolved = ConcurrentHashMap<String, DiscoveredService>()
    var browsing = false
    var failure: String? = null
    var lockReleased = false

    fun releaseLockOnce() {
        if (lockReleased) return
        lockReleased = true
        multicastLock?.releaseIfHeld()
    }

    fun emit() {
        val found = resolved.values.sortedBy { it.name.lowercase() }
        trySend(
            DiscoveryState.Active(
                browsing = browsing,
                found = found,
                failure = failure,
                emptyWhileBrowsing = browsing && found.isEmpty() && failure == null,
            ),
        )
    }

    trySend(DiscoveryState.Active(browsing = false, found = emptyList()))

    var attempts = 0
    var started = false
    var startAttempt: (() -> Unit)? = null

    fun terminal(message: String) {
        failure = message
        emit()
        releaseLockOnce()
        close()
    }

    fun attemptResolve(service: NsdServiceInfo, attemptsSoFar: Int) {
        resolveService(service) { info ->
            if (info == null) {
                if (ResolveRetry.canRetry(attemptsSoFar)) {
                    launch {
                        delay(ResolveRetry.DELAY_MILLIS)
                        attemptResolve(service, attemptsSoFar + 1)
                    }
                }
                return@resolveService
            }
            resolved[info.serviceName] = DiscoveredService(
                name = info.serviceName,
                host = hostAddress(info),
                port = info.port.takeIf { it > 0 },
            )
            emit()
        }
    }

    fun newListener(): NsdManager.DiscoveryListener = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(regType: String) {
            browsing = true
            failure = null
            emit()
        }

        override fun onServiceFound(service: NsdServiceInfo) {
            if (service.serviceType != serviceType && !service.serviceType.contains("openmausbot")) {
                return
            }
            attemptResolve(service, attemptsSoFar = 1)
        }

        override fun onServiceLost(service: NsdServiceInfo) {
            resolved.remove(service.serviceName)
            emit()
        }

        override fun onDiscoveryStopped(regType: String) {
            browsing = false
            emit()
        }

        override fun onStartDiscoveryFailed(regType: String, errorCode: Int) {
            browsing = false
            started = false
            if (!DiscoveryRetry.canRetry(attempts, errorCode)) {
                terminal(failureMessage(errorCode))
                return
            }
            attempts += 1
            failure = DiscoveryRetry.RETRYING
            emit()
            launch {
                delay(DiscoveryRetry.delayFor(attempts))
                startAttempt?.invoke()
            }
        }

        override fun onStopDiscoveryFailed(regType: String, errorCode: Int) {
            browsing = false
            failure = failureMessage(errorCode)
            emit()
        }
    }

    var activeListener: NsdManager.DiscoveryListener? = null
    startAttempt = {
        val listener = newListener()
        activeListener = listener
        try {
            startBrowse(listener)
            started = true
        } catch (error: SecurityException) {
            started = false
            terminal(
                "Local Network access is off. Enable nearby devices permission, " +
                    "or enter a Tailscale address below.",
            )
        } catch (error: Exception) {
            started = false
            terminal(
                error.message
                    ?: "Local discovery isn't available right now. " +
                    "Enter the address shown in Phone settings below.",
            )
        }
    }
    startAttempt.invoke()

    awaitClose {
        if (started) activeListener?.let { runCatching { stopBrowse(it) } }
        stopResolves()
        releaseLockOnce()
    }
}.distinctUntilChanged()

/** Android API 34 registerServiceInfoCallback requires unregisterServiceInfoCallback; older extension levels may throw. */
@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
internal class ServiceInfoResolver(
    private val unregister: (NsdManager.ServiceInfoCallback) -> Unit,
) {
    private val registered: MutableSet<NsdManager.ServiceInfoCallback> =
        Collections.newSetFromMap(ConcurrentHashMap())

    val outstanding: Int get() = registered.size

    fun resolve(
        register: (NsdManager.ServiceInfoCallback) -> Unit,
        onResolved: (NsdServiceInfo?) -> Unit,
    ) {
        var answered = false
        fun answer(info: NsdServiceInfo?) {
            if (answered) return
            answered = true
            onResolved(info)
        }

        val callback = object : NsdManager.ServiceInfoCallback {
            override fun onServiceInfoCallbackRegistrationFailed(errorCode: Int) {
                registered.remove(this)
                answer(null)
            }

            override fun onServiceUpdated(serviceInfo: NsdServiceInfo) {
                release(this)
                answer(serviceInfo)
            }

            override fun onServiceLost() {
                release(this)
                answer(null)
            }

            override fun onServiceInfoCallbackUnregistered() {
                registered.remove(this)
            }
        }
        registered.add(callback)
        try {
            register(callback)
        } catch (error: Exception) {
            registered.remove(callback)
            answer(null)
        }
    }

    fun stopAll() {
        val pending = registered.toList()
        registered.clear()
        pending.forEach { runCatching { unregister(it) } }
    }

    private fun release(callback: NsdManager.ServiceInfoCallback) {
        if (!registered.remove(callback)) return
        runCatching { unregister(callback) }
    }
}

interface CompanionDiscovery {
    fun discover(): Flow<DiscoveryState>
}

class NsdDiscovery(
    context: Context,
    private val serviceType: String = SERVICE_TYPE,
) : CompanionDiscovery {
    private val appContext = context.applicationContext
    private val nsdManager = appContext.getSystemService(NsdManager::class.java)
    private val wifiManager = appContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    private val resolveExecutor: Executor = Executors.newSingleThreadExecutor()
    private val resolver = if (Build.VERSION.SDK_INT >= 34) {
        ServiceInfoResolver(
            unregister = { callback -> nsdManager?.unregisterServiceInfoCallback(callback) },
        )
    } else {
        null
    }

    override fun discover(): Flow<DiscoveryState> {
        if (nsdManager == null) {
            return kotlinx.coroutines.flow.flow {
                emit(
                    DiscoveryState.Active(
                        browsing = false,
                        found = emptyList(),
                        failure = "Local discovery isn't available right now. Enter the address shown in Phone settings below.",
                    ),
                )
            }
        }

        // mDNS/NSD needs the multicast lock on Android 12 and earlier, and on
        // Android 13 below T extension 7 — without it browse silently returns
        // nothing even when NEARBY_WIFI_DEVICES is granted. Acquire only when
        // the cold Flow is collected so close→reopen gets a fresh held lock.
        return browseDiscoveryFlow(
            serviceType = serviceType,
            acquireMulticastLock = ::acquireMulticastLock,
            startBrowse = { listener ->
                nsdManager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener)
            },
            stopBrowse = { listener ->
                nsdManager.stopServiceDiscovery(listener)
            },
            resolveService = { service, onResolved -> resolve(service, onResolved) },
            stopResolves = {
                if (Build.VERSION.SDK_INT >= 34) resolver?.stopAll()
            },
            hostAddress = ::hostAddress,
            failureMessage = ::failureMessage,
        )
    }

    private fun acquireMulticastLock(): MulticastLockHandle? =
        wifiManager
            ?.createMulticastLock(MULTICAST_LOCK_TAG)
            ?.apply {
                setReferenceCounted(false)
                acquire()
            }
            ?.asHandle()


    private fun resolve(service: NsdServiceInfo, onResolved: (NsdServiceInfo?) -> Unit) {
        val manager = nsdManager ?: return onResolved(null)
        if (Build.VERSION.SDK_INT >= 34) {
            resolver?.resolve(
                register = { callback ->
                    manager.registerServiceInfoCallback(service, resolveExecutor, callback)
                },
                onResolved = onResolved,
            ) ?: onResolved(null)
        } else {
            @Suppress("DEPRECATION")
            manager.resolveService(
                service,
                object : NsdManager.ResolveListener {
                    override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) =
                        onResolved(null)
                    override fun onServiceResolved(serviceInfo: NsdServiceInfo) = onResolved(serviceInfo)
                },
            )
        }
    }

    private fun hostAddress(info: NsdServiceInfo): String? {
        if (Build.VERSION.SDK_INT >= 34) {
            val addresses = info.hostAddresses
            if (!addresses.isNullOrEmpty()) {
                return formatAddress(addresses.first())
            }
        }
        @Suppress("DEPRECATION")
        return info.host?.let(::formatAddress)
    }

    private fun formatAddress(address: InetAddress): String {
        val host = address.hostAddress ?: return address.hostName
        return Connection.urlHost(host)
    }

    private fun failureMessage(errorCode: Int): String = when (errorCode) {
        NsdManager.FAILURE_INTERNAL_ERROR ->
            "Local discovery isn't available right now. Enter the address shown in Phone settings below."
        NsdManager.FAILURE_MAX_LIMIT ->
            "Local discovery keeps getting interrupted on this phone. " +
                "Enter the address shown in Phone settings below."
        else ->
            "Local Network access is off. Enable nearby devices permission, or enter a Tailscale address below."
    }

    companion object {
        const val SERVICE_TYPE = "_openmausbot._tcp."
        const val MULTICAST_LOCK_TAG = "openmausbot-nsd"
    }
}
