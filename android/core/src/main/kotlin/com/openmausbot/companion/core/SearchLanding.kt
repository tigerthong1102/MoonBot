package com.openmausbot.companion.core

import kotlinx.serialization.encodeToString

sealed interface SearchHistoryCursor {
    data object Latest : SearchHistoryCursor
    data class Around(val messageId: String) : SearchHistoryCursor
}

class SearchLanding(
    private val threadId: String,
    private val messageId: String,
    private val maximumPages: Int = 40,
    private val maximumBytes: Int = 8 * 1024 * 1024,
) {
    private val started = System.nanoTime()
    private var pages = 1
    private val requested = mutableSetOf<String>()
    private var expectedId = messageId

    fun leaf(state: CompanionState): String? = state.activeLeafIds[threadId] ?: state.botForThread(threadId)?.activeLeafId

    fun merge(page: ThreadPage, state: CompanionState, leafAtRequest: String? = leaf(state)): CompanionState {
        check(System.nanoTime() - started < 30_000_000_000L && pages <= maximumPages) { LIMIT }
        check(page.messages.any { it.id == expectedId }) { UNAVAILABLE }
        val currentLeaf = leaf(state)
        val leaf = if (currentLeaf != leafAtRequest) currentLeaf else page.activeLeafId
        val next = state.merge(page.copy(activeLeafId = leaf), threadId)
        check(CompanionJson.encodeToString(next.transcript(threadId)).encodeToByteArray().size <= maximumBytes) { LIMIT }
        return next
    }

    fun isRendered(state: CompanionState): Boolean {
        val leaf = state.activeLeafIds[threadId] ?: state.botForThread(threadId)?.activeLeafId
        return (leaf == null || state.transcript(threadId).any { it.id == leaf }) &&
            state.visibleTranscript(threadId).any { it.id == messageId }
    }

    fun next(state: CompanionState): SearchHistoryCursor? {
        check(System.nanoTime() - started < 30_000_000_000L) { LIMIT }
        val all = state.transcript(threadId)
        val leaf = state.activeLeafIds[threadId] ?: state.botForThread(threadId)?.activeLeafId
        if (leaf != null && all.none { it.id == leaf }) {
            check(pages < maximumPages && requested.add(leaf)) { UNAVAILABLE }
            pages += 1
            expectedId = leaf
            return SearchHistoryCursor.Latest
        }
        val visible = state.visibleTranscript(threadId)
        if (isRendered(state)) return null
        check(pages < maximumPages) { LIMIT }
        val parent = visible.firstOrNull()?.parentId
        check(parent != null && all.none { it.id == parent } && requested.add(parent)) { UNAVAILABLE }
        pages += 1
        expectedId = parent
        return SearchHistoryCursor.Around(parent)
    }

    companion object {
        const val UNAVAILABLE = "The conversation changed or its history could not be connected. Search again."
        const val LIMIT = "The search result exceeds the history safety limit. Load older messages and try again."
    }
}
