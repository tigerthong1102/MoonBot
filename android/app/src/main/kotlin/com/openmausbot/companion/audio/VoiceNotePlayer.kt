// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

data class VoiceNotePlayback(
    val key: String,
    val playing: Boolean,
    val positionMs: Long,
    val durationMs: Long?,
)

data class VoiceNotePlaybackError(val key: String)

class VoiceNotePlayer internal constructor(
    private val controller: VoiceNoteController,
    processLifecycle: Lifecycle = ProcessLifecycleOwner.get().lifecycle,
) : DefaultLifecycleObserver {

    constructor(
        context: Context,
        processLifecycle: Lifecycle = ProcessLifecycleOwner.get().lifecycle,
    ) : this(
        controller = VoiceNoteController(
            engineFactory = { MediaPlayerVoiceNoteEngine() },
            focus = AudioFocusGate(context.applicationContext),
        ),
        processLifecycle = processLifecycle,
    )

    val playback: StateFlow<VoiceNotePlayback?> get() = controller.playback

    val playbackErrors: SharedFlow<VoiceNotePlaybackError> get() = controller.playbackErrors

    init {
        processLifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) {
                controller.onAppBackgrounded()
            }
        })
    }

    fun play(key: String, data: ByteArray): String? = controller.play(key, data)

    fun pause() = controller.pause()

    fun resume(): String? = controller.resume()

    fun resumable(key: String): Boolean = controller.resumable(key)

    fun seek(key: String, positionMs: Long) = controller.seek(key, positionMs)

    fun refresh() = controller.refresh()
}

/**
 * Pure playback state machine — unit-tested without MediaPlayer.
 *
 * Transitions pinned to the desktop `VoiceNoteBubble` contract:
 * Idle → Playing on successful [play]; a replacing [play] releases the old
 * engine first; [pause] keeps the position and gives the voice back;
 * [resume] re-claims; [seek] moves the clip; completion parks the clip at
 * its end (playing = false, engine released) so play restarts from zero;
 * focus loss and app background pause rather than stop. Failures surface
 * [PLAYBACK_ERROR] — synchronously from [play]/[resume], asynchronously on
 * [playbackErrors].
 *
 * All transitions are serialized on [lock] and generation-guarded so a stale
 * engine callback cannot resurrect a replaced note or leak a MediaPlayer.
 */
class VoiceNoteController(
    private val engineFactory: () -> VoiceNoteEngine,
    private val focus: PreviewAudioFocus,
) {
    private val lock = Any()
    private var engine: VoiceNoteEngine? = null
    private var generation = 0
    private val _playback = MutableStateFlow<VoiceNotePlayback?>(null)
    private val _playbackErrors = MutableSharedFlow<VoiceNotePlaybackError>(extraBufferCapacity = 1)

    val playback: StateFlow<VoiceNotePlayback?> = _playback.asStateFlow()
    val playbackErrors: SharedFlow<VoiceNotePlaybackError> = _playbackErrors.asSharedFlow()

    fun play(key: String, data: ByteArray): String? = synchronized(lock) {
        releaseInternal(abandonFocus = true)
        if (!focus.request(onInterrupted = ::onFocusInterrupted)) {
            focus.abandon()
            return PLAYBACK_ERROR
        }
        val next = engineFactory()
        val gen = generation + 1
        generation = gen
        next.onCompletion = {
            synchronized(lock) {
                if (gen != generation) return@synchronized
                releaseInternal(abandonFocus = true, keepParkedState = true)
            }
        }
        next.onError = {
            synchronized(lock) {
                if (gen != generation) return@synchronized
                releaseInternal(abandonFocus = true)
                _playbackErrors.tryEmit(VoiceNotePlaybackError(key))
            }
        }
        return try {
            val started = next.start(data, startPositionMs = 0L)
            if (!started || gen != generation) {
                next.release()
                focus.abandon()
                _playback.value = null
                if (!started) PLAYBACK_ERROR else null
            } else {
                engine = next
                _playback.value = VoiceNotePlayback(
                    key = key,
                    playing = true,
                    positionMs = 0L,
                    durationMs = durationOf(next),
                )
                null
            }
        } catch (_: Exception) {
            next.release()
            focus.abandon()
            _playback.value = null
            PLAYBACK_ERROR
        }
    }

    fun pause() = synchronized(lock) { pauseInternal() }

    fun resume(): String? = synchronized(lock) {
        val state = _playback.value ?: return null
        val current = engine ?: return null
        if (state.playing) return null
        if (!focus.request(onInterrupted = ::onFocusInterrupted)) {
            focus.abandon()
            return PLAYBACK_ERROR
        }
        return try {
            current.resume()
            _playback.value = state.copy(playing = true, positionMs = positionOf(current, state.positionMs))
            null
        } catch (_: Exception) {
            releaseInternal(abandonFocus = true)
            PLAYBACK_ERROR
        }
    }

    fun resumable(key: String): Boolean = synchronized(lock) {
        val state = _playback.value
        state != null && state.key == key && !state.playing && engine != null
    }

    fun seek(key: String, positionMs: Long) = synchronized(lock) {
        val state = _playback.value ?: return
        if (state.key != key) return
        val duration = state.durationMs
        val target = positionMs.coerceIn(0L, duration?.takeIf { it > 0 }?.let { it - 1 } ?: Long.MAX_VALUE)
        val current = engine
        if (current == null) {
            _playback.value = state.copy(positionMs = target)
            return
        }
        try {
            current.seekTo(target)
            _playback.value = state.copy(positionMs = positionOf(current, target))
        } catch (_: Exception) {
            _playback.value = state.copy(positionMs = target)
        }
    }

    fun refresh() = synchronized(lock) {
        val state = _playback.value ?: return
        val current = engine ?: return
        if (!state.playing) return
        val position = current.positionMs()
        if (position >= 0) {
            _playback.value = state.copy(positionMs = position)
        }
    }

    fun onAppBackgrounded() = synchronized(lock) { pauseInternal() }

    private fun onFocusInterrupted() {
        synchronized(lock) { pauseInternal() }
    }

    private fun pauseInternal() {
        val state = _playback.value ?: return
        val current = engine
        if (current == null) {
            if (state.playing) _playback.value = state.copy(playing = false)
            return
        }
        try {
            current.pause()
            _playback.value = state.copy(
                playing = false,
                positionMs = positionOf(current, state.positionMs),
            )
        } catch (_: Exception) {
            releaseInternal(abandonFocus = true)
            return
        }
        focus.abandon()
    }

    private fun releaseInternal(abandonFocus: Boolean, keepParkedState: Boolean = false) {
        val current = engine
        engine = null
        generation += 1
        current?.stop()
        current?.release()
        if (abandonFocus && current != null) focus.abandon()
        if (keepParkedState && current != null) {
            val state = _playback.value
            if (state != null) {
                _playback.value = state.copy(
                    playing = false,
                    positionMs = state.durationMs?.takeIf { it > 0 } ?: state.positionMs,
                )
            }
        } else if (!keepParkedState) {
            _playback.value = null
        }
    }

    private fun positionOf(current: VoiceNoteEngine, fallback: Long): Long =
        current.positionMs().takeIf { it >= 0 } ?: fallback

    private fun durationOf(current: VoiceNoteEngine): Long? =
        current.durationMs().takeIf { it > 0 }

    companion object {
        const val PLAYBACK_ERROR: String = "The voice note could not be played."
    }
}

/** One playable clip; MediaPlayer in production, a fake in tests. */
interface VoiceNoteEngine {
    var onCompletion: (() -> Unit)?
    var onError: (() -> Unit)?
    fun start(data: ByteArray, startPositionMs: Long): Boolean
    fun pause()
    fun resume()
    fun seekTo(positionMs: Long)
    fun positionMs(): Long
    fun durationMs(): Long
    fun stop()
    fun release()
}

/**
 * MediaPlayer backed by the same in-memory [ByteArrayMediaDataSource] as the
 * TTS preview — voice-note bytes never touch disk.
 */
internal class MediaPlayerVoiceNoteEngine : VoiceNoteEngine {
    override var onCompletion: (() -> Unit)? = null
    override var onError: (() -> Unit)? = null
    private var player: MediaPlayer? = null

    override fun start(data: ByteArray, startPositionMs: Long): Boolean {
        val mediaPlayer = MediaPlayer()
        player = mediaPlayer
        mediaPlayer.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build(),
        )
        mediaPlayer.setDataSource(ByteArrayMediaDataSource(data))
        mediaPlayer.setOnCompletionListener { onCompletion?.invoke() }
        mediaPlayer.setOnErrorListener { _, _, _ ->
            onError?.invoke()
            true
        }
        mediaPlayer.prepare()
        if (startPositionMs > 0) mediaPlayer.seekTo(startPositionMs.toInt())
        mediaPlayer.start()
        return true
    }

    override fun pause() {
        runCatching { player?.pause() }
    }

    override fun resume() {
        runCatching { player?.start() }
    }

    override fun seekTo(positionMs: Long) {
        runCatching { player?.seekTo(positionMs.toInt()) }
    }

    override fun positionMs(): Long = runCatching { player?.currentPosition?.toLong() ?: -1L }.getOrDefault(-1L)

    override fun durationMs(): Long = runCatching { player?.duration?.toLong() ?: -1L }.getOrDefault(-1L)

    override fun stop() {
        runCatching {
            player?.let { if (it.isPlaying) it.stop() }
        }
    }

    override fun release() {
        runCatching { player?.release() }
        player = null
        onCompletion = null
        onError = null
    }
}
