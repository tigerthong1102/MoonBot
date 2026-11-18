// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import com.openmausbot.companion.core.NotificationTarget
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class PendingThreadNavigation(consumedToken: String? = null) {
    private val _pending = MutableStateFlow<NotificationTarget?>(null)
    val pending: StateFlow<NotificationTarget?> = _pending.asStateFlow()

    private var consumed: String? = consumedToken

        fun offer(target: NotificationTarget?, fresh: Boolean = false) {
        val next = target ?: return
        val token = tokenOf(next)
        if (fresh) {
            consumed = null
        } else if (token == consumed) {
            return
        }
        _pending.value = next
    }

    fun offer(botId: String?, threadId: String?, connectionId: String?, fresh: Boolean = false) {
        offer(NotificationTarget.from(botId, threadId, connectionId), fresh)
    }

        fun consume() {
        consumed = _pending.value?.let(::tokenOf) ?: consumed
        _pending.value = null
    }

        fun consume(target: NotificationTarget) {
        val token = tokenOf(target)
        val current = _pending.value ?: return
        if (tokenOf(current) != token) return
        consumed = token
        _pending.value = null
    }

        fun consumedToken(): String? = consumed

    companion object {
                fun tokenOf(target: NotificationTarget): String =
            "v2:${target.connectionId.length}:${target.connectionId}${target.botId.length}:${target.botId}${target.threadId}"

        fun parseToken(raw: String?): NotificationTarget? {
            if (raw == null || !raw.startsWith("v2:")) return null
            var start = 3
            fun part(): String? {
                val mark = raw.indexOf(':', start)
                if (mark < start) return null
                val length = raw.substring(start, mark).toIntOrNull() ?: return null
                start = mark + 1
                if (length <= 0 || length > raw.length - start) return null
                return raw.substring(start, start + length).also { start += length }
            }
            val connectionId = part() ?: return null
            val botId = part() ?: return null
            return NotificationTarget.from(botId, raw.substring(start), connectionId)
        }
    }
}
