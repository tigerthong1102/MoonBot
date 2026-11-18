// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.core

// Connection records contain no device tokens and may be backed up separately.
interface ConnectionStore {
    suspend fun load(): Connection?
    suspend fun save(connection: Connection)
    suspend fun clear()

    /** The connection registry contains no device tokens; tokens must remain in the encrypted token store. */
    suspend fun loadRegistry(): ConnectionRegistryRestore {
        val legacy = load()
        return if (legacy == null) {
            ConnectionRegistryRestore(ConnectionRegistry(), migratedLegacyConnection = false)
        } else {
            ConnectionRegistryRestore(
                ConnectionRegistry(listOf(legacy), legacy.id),
                migratedLegacyConnection = false,
            )
        }
    }

    suspend fun saveRegistry(registry: ConnectionRegistry) {
        val active = registry.activeConnection
        if (active != null) save(active) else clear()
    }

    suspend fun clearRegistry() = clear()
}

/**
 * Device-token store — Keychain analogue. Must not appear in any backup path.
 *
 * Distinguishes "no token" from "cannot read yet" the same way iOS Keychain does:
 * a locked/unavailable store is offline, never unpaired.
 */
interface TokenStore {
    sealed class ReadResult {
        data class Found(val token: String) : ReadResult()
        data object Missing : ReadResult()
        data class Unavailable(val locked: Boolean, val message: String) : ReadResult()
    }

    suspend fun save(connectionId: String, token: String)
    suspend fun read(connectionId: String): ReadResult
    suspend fun remove(connectionId: String)
}

// Onboarding markers cannot contain credentials; persistence must finish before reporting success.
interface OnboardingStore {
    suspend fun notificationOnboardingPending(): Boolean
    suspend fun setNotificationOnboardingPending(pending: Boolean)
}

class InMemoryOnboardingStore(initial: Boolean = false) : OnboardingStore {
    private var pending = initial
    override suspend fun notificationOnboardingPending(): Boolean = pending
    override suspend fun setNotificationOnboardingPending(pending: Boolean) {
        this.pending = pending
    }
}

interface NotificationSink {
    fun deliver(notification: NotificationFrame, sequence: Int?, connectionId: String)
    fun setBadge(count: Int)
}

object NoOpNotificationSink : NotificationSink {
    override fun deliver(notification: NotificationFrame, sequence: Int?, connectionId: String) = Unit
    override fun setBadge(count: Int) = Unit
}

data class ExportedTranscript(
    val data: ByteArray,
    val filename: String,
    val contentType: String,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is ExportedTranscript) return false
        return filename == other.filename &&
            contentType == other.contentType &&
            data.contentEquals(other.data)
    }

    override fun hashCode(): Int {
        var result = data.contentHashCode()
        result = 31 * result + filename.hashCode()
        result = 31 * result + contentType.hashCode()
        return result
    }
}
