// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import com.openmausbot.companion.core.Chat
import com.openmausbot.companion.core.ChatTarget
import com.openmausbot.companion.core.target

sealed interface Destination {
    data object Roster : Destination
    data object Settings : Destination

    data object Routines : Destination

    data object ConnectedApps : Destination
    data object Voice : Destination

    data class Computer(val botId: String) : Destination

    data class Overview(val botId: String) : Destination

    sealed interface Conversation : Destination

    data class Chat(val target: ChatTarget) : Conversation

    data class Thread(val threadId: String) : Conversation
}

@Stable
class CompanionNavigator(initial: List<Destination> = listOf(Destination.Roster)) {
    var stack: List<Destination> by mutableStateOf(initial.ifEmpty { listOf(Destination.Roster) })
        private set

    val current: Destination get() = stack.last()
    val canGoBack: Boolean get() = stack.size > 1

    fun push(destination: Destination) {
        if (stack.last() == destination) return
        stack = stack + destination
    }

    fun open(chat: Chat) {
        push(Destination.Chat(chat.target))
    }

    fun pop() {
        if (canGoBack) stack = stack.dropLast(1)
    }

    fun retainsChatDraft(chatId: String): Boolean =
        stack.any { destination ->
            destination is Destination.Chat && when (val target = destination.target) {
                is ChatTarget.Bot -> target.botId == chatId
                is ChatTarget.Room -> target.roomId == chatId
            }
        }

    fun resetToRoster() {
        stack = listOf(Destination.Roster)
    }

    fun openThread(threadId: String) {
        stack = listOf(Destination.Roster, Destination.Thread(threadId))
    }

    fun openFromNotification(chat: Chat) {
        stack = listOf(Destination.Roster, Destination.Chat(chat.target))
    }

    fun resolveThread(threadId: String, target: ChatTarget) {
        selectTask(Destination.Thread(threadId), target)
    }

    fun selectTask(from: Destination.Conversation, target: ChatTarget) {
        if (stack.last() != from) return
        stack = stack.dropLast(1) + Destination.Chat(target)
    }

    companion object {
        private const val ROSTER = "roster"
        private const val SETTINGS = "settings"
        private const val ROUTINES = "routines"
        private const val CONNECTED_APPS = "connected-apps"
        private const val VOICE = "voice"
        private const val THREAD = "thread:"
        private const val COMPUTER = "computer:"
        private const val OVERVIEW = "overview:"
        private const val BOT_CHAT = "botchat:"
        private const val ROOM_CHAT = "roomchat:"

        fun encode(stack: List<Destination>): List<String> = stack.map {
            when (it) {
                Destination.Roster -> ROSTER
                Destination.Settings -> SETTINGS
                Destination.Routines -> ROUTINES
                Destination.ConnectedApps -> CONNECTED_APPS
                Destination.Voice -> VOICE
                is Destination.Thread -> THREAD + it.threadId
                is Destination.Computer -> COMPUTER + it.botId
                is Destination.Overview -> OVERVIEW + it.botId
                is Destination.Chat -> when (val target = it.target) {
                    is ChatTarget.Bot -> BOT_CHAT + join(target.botId, target.threadId)
                    is ChatTarget.Room -> ROOM_CHAT + join(target.roomId, target.threadId)
                }
            }
        }

        fun decode(raw: List<String>): List<Destination> = raw.mapNotNull {
            when {
                it == ROSTER -> Destination.Roster
                it == SETTINGS -> Destination.Settings
                it == ROUTINES -> Destination.Routines
                it == CONNECTED_APPS -> Destination.ConnectedApps
                it == VOICE -> Destination.Voice
                it.startsWith(THREAD) -> Destination.Thread(it.removePrefix(THREAD))
                it.startsWith(COMPUTER) -> Destination.Computer(it.removePrefix(COMPUTER))
                it.startsWith(OVERVIEW) -> Destination.Overview(it.removePrefix(OVERVIEW))
                it.startsWith(BOT_CHAT) -> split(it.removePrefix(BOT_CHAT))
                    ?.let { (owner, thread) -> Destination.Chat(ChatTarget.Bot(owner, thread)) }
                it.startsWith(ROOM_CHAT) -> split(it.removePrefix(ROOM_CHAT))
                    ?.let { (owner, thread) -> Destination.Chat(ChatTarget.Room(owner, thread)) }
                else -> null
            }
        }

        private fun join(owner: String, threadId: String): String =
            "${owner.length}:$owner$threadId"

        private fun split(raw: String): Pair<String, String>? {
            val mark = raw.indexOf(':')
            if (mark <= 0) return null
            val length = raw.substring(0, mark).toIntOrNull() ?: return null
            val start = mark + 1
            if (length < 0 || start + length > raw.length) return null
            return raw.substring(start, start + length) to raw.substring(start + length)
        }

        private const val BOND_MARKER = "bond:"

        fun saver(bondGeneration: Int): Saver<CompanionNavigator, List<String>> = Saver(
            save = { listOf(BOND_MARKER + bondGeneration) + encode(it.stack) },
            restore = { restoreForGeneration(it, bondGeneration) },
        )

        fun restoreForGeneration(raw: List<String>, expectedGeneration: Int): CompanionNavigator? {
            val header = raw.firstOrNull() ?: return null
            if (!header.startsWith(BOND_MARKER)) return null
            val saved = header.removePrefix(BOND_MARKER).toIntOrNull() ?: return null
            if (saved != expectedGeneration) return null
            return CompanionNavigator(decode(raw.drop(1)))
        }

        fun encodeWithBond(stack: List<Destination>, bondGeneration: Int): List<String> =
            listOf(BOND_MARKER + bondGeneration) + encode(stack)
    }
}

@Composable
fun rememberCompanionNavigator(bondGeneration: Int = 0): CompanionNavigator =
    rememberSaveable(bondGeneration, saver = CompanionNavigator.saver(bondGeneration)) {
        CompanionNavigator()
    }
