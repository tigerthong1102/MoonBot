package com.openmausbot.companion.core

import kotlinx.serialization.Serializable

@Serializable
data class AiTwinStatus(val twin: AiTwinProfile? = null, val preview: AiTwinProvider? = null)

@Serializable
data class AiTwinProfile(val id: String, val name: String, val revision: Long, val paused: Boolean)

@Serializable
data class AiTwinProvider(val key: String, val name: String, val model: String)

@Serializable
data class AiTwinAnswer(val lesson: Lesson? = null, val draft: String? = null, val match: String? = null) {
    @Serializable
    data class Lesson(val question: String, val answer: String)
}

enum class AiTwinAction { Exact, Semantic, Draft }
