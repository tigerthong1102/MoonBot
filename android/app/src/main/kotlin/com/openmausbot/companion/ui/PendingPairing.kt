// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.runtime.saveable.Saver
import com.openmausbot.companion.core.CompanionJson
import com.openmausbot.companion.core.Connection
import com.openmausbot.companion.core.PairingInvite
import java.util.UUID
import kotlinx.serialization.Serializable

/** One-time pairing credentials and codes must remain in process memory, never saved state. */
internal class PairingSecretStore {
    private var handle: String? = null
    private var credential: String? = null
    private var code: String = ""
    private var pairRequestId: String? = null
    private var attempting: String? = null

    /** Saved-state handles must contain no pairing credential and must be unusable without the in-memory secret. */
    @Synchronized
    fun open(credential: String? = null): String? {
        if (isRedeeming()) return null
        val minted = UUID.randomUUID().toString()
        handle = minted
        this.credential = credential
        this.code = ""
        this.pairRequestId = UUID.randomUUID().toString()
        return minted
    }

    // A one-time credential cannot be replaced while its redemption may already be committed.
    @Synchronized
    fun beginAttempt(handle: String?): Boolean {
        if (!owns(handle) || attempting != null) return false
        attempting = handle
        return true
    }

    @Synchronized
    fun endAttempt(handle: String?) {
        if (attempting == handle) attempting = null
    }


    @Synchronized
    fun isRedeeming(): Boolean = attempting != null && attempting == handle

    @Synchronized
    fun owns(handle: String?): Boolean = handle != null && handle == this.handle

    /** The scanned credential, or null once the process that scanned it is gone. */
    @Synchronized
    fun credential(handle: String?): String? = if (owns(handle)) credential else null

    @Synchronized
    fun code(handle: String?): String = if (owns(handle)) code else ""

    /** Stable for Retry, and absent from saved state alongside the one-time credential. */
    @Synchronized
    fun pairRequestId(handle: String?): String? = if (owns(handle)) pairRequestId else null

    @Synchronized
    fun setCode(handle: String?, value: String) {
        if (owns(handle)) code = value
    }

    @Synchronized
    fun resetAttempt(handle: String?) {
        if (!owns(handle)) return
        code = ""
        pairRequestId = UUID.randomUUID().toString()
    }


    @Synchronized
    fun clear(handle: String?) {
        if (!owns(handle)) return
        this.handle = null
        credential = null
        code = ""
        pairRequestId = null
    }
}

internal val PairingSecrets = PairingSecretStore()

/** Pairing confirmation metadata must contain no secret. */
@Serializable
internal class PendingPairing private constructor(
    val connection: Connection,
    val fromScan: Boolean,
    val handle: String,
) {
    override fun equals(other: Any?): Boolean =
        this === other ||
            (
                other is PendingPairing &&
                    connection == other.connection &&
                    fromScan == other.fromScan &&
                    handle == other.handle
                )

    override fun hashCode(): Int {
        var result = connection.hashCode()
        result = 31 * result + fromScan.hashCode()
        result = 31 * result + handle.hashCode()
        return result
    }

    /** No credential and no code here, and none may ever be added. */
    override fun toString(): String =
        "PendingPairing(connection=$connection, fromScan=$fromScan, handle=$handle)"

    companion object {
        fun opening(
            secrets: PairingSecretStore,
            connection: Connection,
            fromScan: Boolean,
            credential: String? = null,
        ): PendingPairing? =
            secrets.open(credential)?.let { PendingPairing(connection, fromScan, it) }
    }
}

/** The scanned credential for this pairing, if this process is still the one holding it. */
internal fun PendingPairing.credential(secrets: PairingSecretStore = PairingSecrets): String? =
    secrets.credential(handle)

/**
 * True when a scanned pairing has outlived its credential and the user must
 * rescan rather than retry something that may already have been redeemed.
 */
internal fun PendingPairing.needsRescan(secrets: PairingSecretStore = PairingSecrets): Boolean =
    fromScan && secrets.credential(handle) == null


internal fun PendingPairing.rebindingIfOrphaned(
    secrets: PairingSecretStore = PairingSecrets,
): PendingPairing {
    if (fromScan || secrets.owns(handle)) return this
    return PendingPairing.opening(secrets, connection, fromScan = false) ?: this
}


internal fun PairingSecretStore.takeInvite(
    current: PendingPairing?,
    invite: PairingInvite,
    consume: () -> Unit,
): PendingPairing? {
    val opened = PendingPairing.opening(
        secrets = this,
        connection = invite.connection,
        fromScan = true,
        credential = invite.credential,
    ) ?: return current
    consume()
    return opened
}

internal fun PairingSecretStore.endAttemptTaking(
    handle: String?,
    current: PendingPairing?,
    invite: PairingInvite?,
    consume: () -> Unit,
): PendingPairing? {
    endAttempt(handle)
    if (invite == null) return current
    return takeInvite(current, invite, consume)
}

/**
 * Through saved instance state. `Connection` is already `@Serializable` for the
 * connection store, so one encoding serves both and there is no second shape of
 * the record to keep in step. Nothing secret passes through here.
 */
internal val PendingPairingSaver: Saver<PendingPairing?, String> = Saver(
    save = { pending ->
        pending?.let { CompanionJson.encodeToString(PendingPairing.serializer(), it) }
    },
    restore = { encoded ->
        runCatching { CompanionJson.decodeFromString(PendingPairing.serializer(), encoded) }
            .getOrNull()
    },
)

internal data class PairingConfirmation(
    val name: String,
    /** Complete normalized origin, without any path, query or credential. */
    val address: String,
    val usesHttps: Boolean,
    val step: Step,
) {
    sealed interface Step {
        /** A scan whose one-time credential is still in this process: one tap pairs. */
        data class Confirm(val credential: String) : Step

        data object EnterCode : Step

        data object Rescan : Step
    }

    val notice: String
        get() = when (step) {
            is Step.Confirm -> if (usesHttps) PairingCopy.CONFIRM_HTTPS else PairingCopy.CONFIRM_SCAN
            Step.EnterCode -> PairingCopy.ENTER_CODE
            Step.Rescan -> PairingCopy.RESCAN
        }

    companion object {
        fun of(
            pending: PendingPairing,
            secrets: PairingSecretStore = PairingSecrets,
        ): PairingConfirmation {
            val connection = pending.connection
            val address = connection.pairingConsentOrigin
            return PairingConfirmation(
                name = connection.name.ifBlank { address },
                address = address,
                usesHttps = connection.activeEndpoint?.isSecure == true,
                step = when {
                    pending.needsRescan(secrets) -> Step.Rescan
                    else -> pending.credential(secrets)?.let(Step::Confirm) ?: Step.EnterCode
                },
            )
        }
    }
}

/**
 * The confirmation's wording, in one place because this is the part §6 cares
 * about: what pairing authenticates, and what it does not encrypt.
 */
internal object PairingCopy {
    const val CONFIRM_HTTPS: String =
        "Only continue if this is the computer whose QR code you just scanned. " +
            "Confirming establishes an authenticated HTTPS companion connection."

    // LAN HTTP pairing authenticates devices but does not encrypt traffic; use a trusted network or tailnet.
    const val CONFIRM_SCAN: String =
        "Only continue if this is the computer whose QR code you just scanned. " +
            "Confirming establishes an authenticated companion connection. Use a " +
            "trusted Wi-Fi network or a tailnet; StartupBot does not encrypt " +
            "local Wi-Fi traffic."

    const val ENTER_CODE: String = "Enter the pairing code shown on your computer or server:"

    const val RESCAN: String =
        "This app restarted before the pairing finished. That one-time code is " +
            "never reused, because it may already have been redeemed. Start pairing " +
            "again on your computer and scan the new QR code."
}
