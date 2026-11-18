// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.core

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.Serializable

sealed interface SendReceipt {
    /**
     * In the transcript now. [steered] means it went into a turn that was
     * already running rather than starting one.
     */
    data class Sent(val threadId: String?, val steered: Boolean) : SendReceipt

    /** Held in the harness's steer queue until the current turn settles. */
    data class Queued(val queueId: String, val threadId: String) : SendReceipt
}

/**
 * The 202 body, read leniently. Every field is optional on purpose: a harness
 * older than this app answers `{ok:true}` and nothing else, and that is a
 * plain send, not a failure.
 */
@Serializable
data class SendReceiptBody(
    val threadId: String? = null,
    val queued: Boolean? = null,
    val queueId: String? = null,
    val steered: Boolean? = null,
) {
    fun receipt(): SendReceipt =
        if (queued == true && queueId != null && threadId != null) {
            SendReceipt.Queued(queueId, threadId)
        } else {
            SendReceipt.Sent(threadId, steered == true)
        }
}

/** A message waiting in the harness's steer queue, as this client knows it. */
data class QueuedSend(val queueId: String, val text: String) {

    fun editDraft(keeping: String): String =
        if (keeping.isBlank()) text else "$text\n\n$keeping"
}

/**
 * One held send off the wire, as the steer-queue snapshot emits it. Both
 * fields are required: an entry without the pair is not something a row can
 * be built from, so it drops out the way a lossy array does on iOS. The
 * server's advisory reason field is not kept - the text renders either way.
 */
internal fun JsonObject.queuedSendOrNull(): QueuedSend? {
    val queueId = this["queueId"]?.jsonPrimitive?.contentOrNull ?: return null
    val text = this["text"]?.jsonPrimitive?.contentOrNull ?: return null
    return QueuedSend(queueId, text)
}

/** The wire shape of a held send, for frames this client re-encodes. */
internal fun QueuedSend.toJsonObject(): JsonObject = buildJsonObject {
    put("queueId", queueId)
    put("text", text)
}
