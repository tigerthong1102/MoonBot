// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import com.openmausbot.companion.core.PendingMessageAttachment
import com.openmausbot.companion.core.DraftProvenance
import com.openmausbot.companion.core.VolatileDraft

class ChatDraftHolder {
    class Attachments {
        val items = mutableStateListOf<PendingMessageAttachment>()
        val preparing = mutableStateOf(false)
        val sending = mutableStateOf(false)
        val error = mutableStateOf<String?>(null)
    }

    private val owners = mutableMapOf<String, MutableSet<String>>()
    private val attachments = mutableMapOf<String, Attachments>()
    private val composers = mutableMapOf<String, ChatComposerDraft>()

    fun composer(conversationId: String, initialSaveable: String = ""): ChatComposerDraft =
        composers.getOrPut(conversationId) { ChatComposerDraft(conversationId, this, initialSaveable) }

    fun register(ownerId: String, conversationId: String) {
        owners.getOrPut(ownerId) { mutableSetOf() }.add(conversationId)
    }

    fun attachments(conversationId: String): Attachments =
        attachments.getOrPut(conversationId) { Attachments() }

    fun clearOwner(ownerId: String) {
        owners.remove(ownerId)?.forEach(::clear)
    }

    data class Entry(
        val text: String,
        val typedSnapshot: String,
        val contaminated: Boolean,
    ) {
        val volatile: VolatileDraft
            get() = VolatileDraft(text = text, contaminated = contaminated)

        val provenance: DraftProvenance
            get() = DraftProvenance(typedSnapshot = typedSnapshot, contaminated = contaminated)
    }

    private val entries = mutableMapOf<String, Entry>()

    fun get(chatId: String): Entry? = entries[chatId]

    fun put(chatId: String, text: String, provenance: DraftProvenance) {
        if (text.isEmpty() && provenance.typedSnapshot.isEmpty() && !provenance.contaminated) {
            entries.remove(chatId)
            return
        }
        entries[chatId] = Entry(
            text = text,
            typedSnapshot = provenance.typedSnapshot,
            contaminated = provenance.contaminated,
        )
    }

    fun clear(chatId: String) {
        entries.remove(chatId)
        attachments.remove(chatId)
        composers.remove(chatId)
    }
}
