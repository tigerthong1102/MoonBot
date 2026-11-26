// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.core

enum class RoomCouncilMode {
    OFF,
    INDEPENDENT,
    CRITIQUE;

    fun message(question: String): String = when (this) {
        OFF -> question
        INDEPENDENT -> "/council $question"
        CRITIQUE -> "/council --critique $question"
    }
}
