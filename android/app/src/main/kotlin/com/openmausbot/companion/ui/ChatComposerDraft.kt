// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import com.openmausbot.companion.core.Dictation
import com.openmausbot.companion.core.DraftProvenance

class ChatComposerDraft(
    private val chatId: String,
    private val holder: ChatDraftHolder,
    initialSaveable: String,
) {
    var text: String by mutableStateOf("")
        private set

    var saveableValue: String
        private set

    var contaminated: Boolean
        private set

    val provenance: DraftProvenance
        get() = DraftProvenance(typedSnapshot = saveableValue, contaminated = contaminated)

    init {
        val held = holder.get(chatId)
        val seeded = Dictation.seedVolatileDraft(held?.volatile, initialSaveable)
        text = seeded.text
        contaminated = seeded.contaminated
        saveableValue = held?.typedSnapshot ?: initialSaveable
        if (holder.get(chatId) == null) {
            holder.put(chatId, text, provenance)
        }
    }

    fun publish(next: String, nextProvenance: DraftProvenance) {
        text = next
        saveableValue = nextProvenance.typedSnapshot
        contaminated = nextProvenance.contaminated
        holder.put(chatId, next, nextProvenance)
    }

    fun onTypedChange(next: String) {
        if (next.isEmpty()) {
            publish("", Dictation.afterClear())
        } else {
            publish(next, Dictation.afterTypedEdit(provenance, next))
        }
    }

    fun onDictation(merged: String) {
        val current = holder.get(chatId)?.provenance ?: provenance
        publish(merged, Dictation.afterDictation(current))
    }

    fun onSendResult(acknowledged: Boolean, capturedText: String): Boolean {
        if (!acknowledged || text != capturedText) return false
        onSend()
        return true
    }

    fun onSend() {
        publish("", Dictation.afterClear())
    }

    fun onLeaveToRoster() {
        publish("", Dictation.afterClear())
    }

    companion object {
        private const val TYPED_MARKER = "typed:"

        fun saver(
            chatId: String,
            holder: ChatDraftHolder,
        ): Saver<ChatComposerDraft, Any> = Saver(
            save = { listOf(TYPED_MARKER, it.saveableValue) },
            restore = { raw ->
                holder.composer(
                    chatId,
                    initialSaveable = typedSnapshotFromSaved(raw).orEmpty(),
                )
            },
        )

        fun typedSnapshotFromSaved(raw: Any?): String? {
            val list = raw as? List<*> ?: return null
            if (list.size != 2) return null
            if (list[0] != TYPED_MARKER) return null
            return list[1] as? String
        }
    }
}
