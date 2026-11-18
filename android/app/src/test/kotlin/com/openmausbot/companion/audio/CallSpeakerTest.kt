package com.openmausbot.companion.audio

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

class CallSpeakerTest {
    @Test
    fun deniedFocusDoesNotCreateOrStartAnyClipAndReleasesTheRequest() = runTest {
        val focus = Focus(false)
        var engines = 0
        val speaker = CallSpeaker({ engines++; Engine() }, focus)
        assertFalse(speaker.speak(listOf(byteArrayOf(1), byteArrayOf(2))))
        assertEquals(0, engines)
        assertEquals(1, focus.requests)
        assertEquals(1, focus.abandons)
        assertFalse(speaker.isSpeaking.value)
    }

    @Test
    fun grantedFocusPlaysEveryClipAndReturnsToIdle() = runTest {
        val focus = Focus(true)
        val engines = mutableListOf<Engine>()
        val speaker = CallSpeaker({ Engine().also(engines::add) }, focus)
        assertTrue(speaker.speak(listOf(byteArrayOf(1), byteArrayOf(2))))
        assertEquals(2, engines.size)
        assertTrue(engines.all { it.starts == 1 && it.releases == 1 })
        assertEquals(1, focus.abandons)
        assertFalse(speaker.isSpeaking.value)
    }

    private class Focus(private val granted: Boolean) : PreviewAudioFocus {
        var requests = 0
        var abandons = 0
        override fun request(onInterrupted: () -> Unit): Boolean { requests++; return granted }
        override fun abandon() { abandons++ }
    }

    private class Engine : PreviewAudioEngine {
        override var onCompletion: (() -> Unit)? = null
        override var onError: (() -> Unit)? = null
        var starts = 0
        var releases = 0
        override fun start(data: ByteArray): Boolean { starts++; onCompletion?.invoke(); return true }
        override fun stop() = Unit
        override fun release() { releases++ }
    }
}
