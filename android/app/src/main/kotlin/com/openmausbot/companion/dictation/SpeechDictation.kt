// Modified for StartupBot; original copyright and license retained.
package com.openmausbot.companion.dictation

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.openmausbot.companion.core.Dictation
import java.util.Locale
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

// Android API 31+ may provide an on-device recognizer; the platform default recognizer may use the network.
// Dictation audio remains in memory.
class SpeechDictation internal constructor(
    private val engineFactory: SpeechEngineFactory,
    private val hasRecordAudio: () -> Boolean,
    private val requestRecordAudio: (onResult: (Boolean) -> Unit) -> Unit,
    private val focus: DictationAudioFocus,
    private val preferredLanguages: () -> List<String>,
    private val currentLocale: () -> Locale,
    private val postMain: (() -> Unit) -> Unit = { block ->
        Handler(Looper.getMainLooper()).post(block)
    },
    private val postDelayed: (delayMillis: Long, block: () -> Unit) -> Unit = { delayMillis, block ->
        Handler(Looper.getMainLooper()).postDelayed(block, delayMillis)
    },
    private val clock: () -> Long = { System.nanoTime() / 1_000_000 },
) : DefaultLifecycleObserver {

    constructor(
        context: Context,
        hasRecordAudio: () -> Boolean,
        requestRecordAudio: (onResult: (Boolean) -> Unit) -> Unit,
        preferredLanguages: () -> List<String>,
        currentLocale: () -> Locale = { Locale.getDefault() },
    ) : this(
        engineFactory = AndroidSpeechEngineFactory(context.applicationContext),
        hasRecordAudio = hasRecordAudio,
        requestRecordAudio = requestRecordAudio,
        focus = DictationAudioFocusGate(context.applicationContext),
        preferredLanguages = preferredLanguages,
        currentLocale = currentLocale,
    )

    private val lock = Any()
    private val screenLifecycle = AtomicReference<Lifecycle?>(null)

    private var engine: SpeechEngine? = null
    private var generation: Int = 0
    private var attempt: Int = 0
    private var stopping: Boolean = false

    private var turnGapMillis: Long? = null
    private var onTurnEnded: ((String) -> Unit)? = null
    private var lastTranscriptChange: Long = 0L

    private val _isListening = MutableStateFlow(false)
    private val _isStarting = MutableStateFlow(false)
    private val _transcript = MutableStateFlow("")
    private val _error = MutableStateFlow<String?>(null)

    @Volatile
    var base: String = ""
        private set

    val isListening: StateFlow<Boolean> = _isListening.asStateFlow()
    val isStarting: StateFlow<Boolean> = _isStarting.asStateFlow()
    val transcript: StateFlow<String> = _transcript.asStateFlow()
    val error: StateFlow<String?> = _error.asStateFlow()

    fun toggle(capturing: String) {
        synchronized(lock) {
            if (_isListening.value || _isStarting.value) {
                stopLocked()
            } else {
                turnGapMillis = null
                onTurnEnded = null
                startLocked(capturing)
            }
        }
    }

    fun stop() {
        synchronized(lock) { stopLocked() }
    }

    fun listenForTurn(endpointGapMillis: Long, onTurn: (String) -> Unit) {
        synchronized(lock) {
            if (_isListening.value || _isStarting.value) return
            turnGapMillis = endpointGapMillis
            onTurnEnded = onTurn
            startLocked("")
            if (onTurnEnded != null) scheduleEndpointCheckLocked(generation)
        }
    }

    private fun scheduleEndpointCheckLocked(gen: Int) {
        postDelayed(ENDPOINT_POLL_MILLIS) {
            synchronized(lock) {
                if (gen != generation || stopping) return@synchronized
                val gap = turnGapMillis ?: return@synchronized
                val heard = _transcript.value.isNotEmpty() && clock() - lastTranscriptChange >= gap
                if (_isListening.value && heard) endTurnLocked() else scheduleEndpointCheckLocked(gen)
            }
        }
    }

    private fun endTurnLocked() {
        val callback = onTurnEnded ?: return
        val heard = _transcript.value
        onTurnEnded = null
        stopLocked()
        postMain { callback(heard) }
    }

    fun locksComposer(): Boolean = _isListening.value || _isStarting.value

    fun bind(owner: LifecycleOwner) {
        val next = owner.lifecycle
        val previous = screenLifecycle.getAndSet(next)
        if (previous !== next) {
            previous?.removeObserver(this)
            if (previous != null) stop()
            next.addObserver(this)
        }
    }

    fun unbind(owner: LifecycleOwner) {
        val current = owner.lifecycle
        if (screenLifecycle.compareAndSet(current, null)) {
            current.removeObserver(this)
            stop()
            _error.value = null
        }
    }

    override fun onStop(owner: LifecycleOwner) {
        if (screenLifecycle.get() === owner.lifecycle) stop()
    }

    override fun onDestroy(owner: LifecycleOwner) {
        if (screenLifecycle.compareAndSet(owner.lifecycle, null)) {
            owner.lifecycle.removeObserver(this)
            stop()
            _error.value = null
        }
    }

    fun onAudioInterrupted(sessionGen: Int) {
        postMain {
            synchronized(lock) {
                if (sessionGen != generation || stopping) return@synchronized
                stopLocked()
            }
        }
    }

    private fun startLocked(capturing: String) {
        if (_isListening.value || _isStarting.value) return
        _error.value = null
        base = capturing.trim()
        _transcript.value = ""
        lastTranscriptChange = clock()
        _isStarting.value = true
        stopping = false
        generation += 1
        val gen = generation

        if (!hasRecordAudio()) {
            postMain {
                requestRecordAudio { granted ->
                    synchronized(lock) {
                        if (gen != generation || stopping) return@synchronized
                        if (!granted) {
                            _isStarting.value = false
                            _error.value = MIC_DENIED_MESSAGE
                            return@synchronized
                        }
                        beginCaptureLocked(gen)
                    }
                }
            }
            return
        }
        beginCaptureLocked(gen)
    }

    private fun beginCaptureLocked(gen: Int) {
        if (gen != generation || stopping) {
            _isStarting.value = false
            return
        }
        val openers = engineFactory.openers()
        if (openers.isEmpty()) {
            _isStarting.value = false
            _error.value = NO_RECOGNIZER_MESSAGE
            return
        }
        val locales = Dictation.localeCandidates(
            preferredLanguages = preferredLanguages(),
            current = currentLocale(),
        )
        attemptLocked(openers, locales, openerIndex = 0, localeIndex = 0, gen = gen)
    }

    private fun attemptLocked(
        openers: List<EngineOpener>,
        locales: List<Locale>,
        openerIndex: Int,
        localeIndex: Int,
        gen: Int,
    ) {
        if (gen != generation || stopping) {
            _isStarting.value = false
            return
        }
        if (openerIndex >= openers.size) {
            _isStarting.value = false
            _error.value = NO_RECOGNIZER_MESSAGE
            return
        }
        if (localeIndex >= locales.size) {
            attemptLocked(openers, locales, openerIndex + 1, 0, gen)
            return
        }

        val opener = openers[openerIndex]
        val next = try {
            opener.open()
        } catch (_: Exception) {
            attemptLocked(openers, locales, openerIndex + 1, 0, gen)
            return
        }

        if (!focus.request(onInterrupted = { onAudioInterrupted(gen) })) {
            next.destroy()
            _isStarting.value = false
            _error.value = START_FAILED_MESSAGE
            return
        }

        attempt += 1
        val attemptId = attempt
        engine = next
        val language = locales[localeIndex].toLanguageTag()
        try {
            next.start(
                RecognitionRequest(
                    languageTag = language,
                    preferOffline = false,
                ),
                listener = EngineListener(
                    gen = gen,
                    attemptId = attemptId,
                    openers = openers,
                    locales = locales,
                    openerIndex = openerIndex,
                    localeIndex = localeIndex,
                ),
            )
            if (gen != generation || stopping) {
                teardownLocked(abandonFocus = true)
                _isStarting.value = false
                return
            }
            _isStarting.value = false
            _isListening.value = true
        } catch (_: Exception) {
            teardownLocked(abandonFocus = true)
            attemptLocked(openers, locales, openerIndex, localeIndex + 1, gen)
        }
    }

    private fun stopLocked() {
        generation += 1
        turnGapMillis = null
        onTurnEnded = null
        attempt += 1
        _isStarting.value = false
        stopping = true
        _isListening.value = false
        teardownLocked(abandonFocus = true)
    }

    private fun teardownLocked(abandonFocus: Boolean) {
        val current = engine
        engine = null
        current?.cancel()
        current?.destroy()
        if (abandonFocus) focus.abandon()
    }

    private fun degradeLocked(
        openers: List<EngineOpener>,
        locales: List<Locale>,
        openerIndex: Int,
        localeIndex: Int,
        gen: Int,
    ) {
        if (gen != generation || stopping) return
        teardownLocked(abandonFocus = true)
        _isListening.value = false
        _isStarting.value = true
        attemptLocked(openers, locales, openerIndex, localeIndex, gen)
    }

    private inner class EngineListener(
        private val gen: Int,
        private val attemptId: Int,
        private val openers: List<EngineOpener>,
        private val locales: List<Locale>,
        private val openerIndex: Int,
        private val localeIndex: Int,
    ) : SpeechEngine.Listener {
        private fun live(): Boolean =
            gen == generation && attemptId == attempt && !stopping

        override fun onPartial(text: String) {
            synchronized(lock) {
                if (!live() || !_isListening.value) return
                val updated = Dictation.updateTranscript(_transcript.value, text)
                if (updated != _transcript.value) {
                    _transcript.value = updated
                    lastTranscriptChange = clock()
                }
            }
        }

        override fun onFinal(text: String) {
            synchronized(lock) {
                if (!live() || !_isListening.value) return
                if (text.isNotEmpty()) _transcript.value = Dictation.updateTranscript(_transcript.value, text)
                if (onTurnEnded != null) endTurnLocked() else stopLocked()
            }
        }

        override fun onError(kind: SpeechEngine.ErrorKind) {
            synchronized(lock) {
                if (!live()) return
                when (kind) {
                    SpeechEngine.ErrorKind.CANCELLED -> stopLocked()
                    SpeechEngine.ErrorKind.PERMISSION -> {
                        _error.value = MIC_DENIED_MESSAGE
                        stopLocked()
                    }
                    SpeechEngine.ErrorKind.LANGUAGE -> {
                        degradeLocked(
                            openers,
                            locales,
                            openerIndex = openerIndex,
                            localeIndex = localeIndex + 1,
                            gen = gen,
                        )
                    }
                    SpeechEngine.ErrorKind.FAILED -> {
                        if (openerIndex + 1 < openers.size) {
                            degradeLocked(
                                openers,
                                locales,
                                openerIndex = openerIndex + 1,
                                localeIndex = 0,
                                gen = gen,
                            )
                        } else if (onTurnEnded != null) {
                            endTurnLocked()
                        } else {
                            _error.value = TRANSCRIBE_FAILED_MESSAGE
                            stopLocked()
                        }
                    }
                }
            }
        }
    }

    companion object {
        const val MIC_DENIED_MESSAGE: String =
            "Dictation needs Microphone access. Enable it in Settings → StartupBot."
        const val NO_RECOGNIZER_MESSAGE: String =
            "Dictation isn't available for this language."
        const val START_FAILED_MESSAGE: String = "Couldn't start the microphone."
        const val TRANSCRIBE_FAILED_MESSAGE: String = "Couldn't transcribe that."
        private const val ENDPOINT_POLL_MILLIS: Long = 100L
    }
}

data class RecognitionRequest(
    val languageTag: String,
    val preferOffline: Boolean,
)

data class EngineOpener(
    val isOnDevice: Boolean,
    val open: () -> SpeechEngine,
)

fun interface SpeechEngineFactory {
    fun openers(): List<EngineOpener>
}

interface SpeechEngine {
    val isOnDevice: Boolean
    fun start(request: RecognitionRequest, listener: Listener)
    fun cancel()
    fun destroy()

    interface Listener {
        fun onPartial(text: String)
        fun onFinal(text: String)
        fun onError(kind: ErrorKind)
    }

    enum class ErrorKind { CANCELLED, PERMISSION, LANGUAGE, FAILED }
}

interface DictationAudioFocus {
    fun request(onInterrupted: () -> Unit): Boolean
    fun abandon()
}

internal class AndroidSpeechEngineFactory(
    private val context: Context,
) : SpeechEngineFactory {
    override fun openers(): List<EngineOpener> {
        val list = ArrayList<EngineOpener>(2)
        if (Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) {
            list += EngineOpener(isOnDevice = true) {
                PlatformSpeechEngine(
                    SpeechRecognizer.createOnDeviceSpeechRecognizer(context),
                    isOnDevice = true,
                )
            }
        }
        if (SpeechRecognizer.isRecognitionAvailable(context)) {
            list += EngineOpener(isOnDevice = false) {
                PlatformSpeechEngine(
                    SpeechRecognizer.createSpeechRecognizer(context),
                    isOnDevice = false,
                )
            }
        }
        return list
    }
}

internal class PlatformSpeechEngine(
    private val recognizer: SpeechRecognizer,
    override val isOnDevice: Boolean,
) : SpeechEngine {
    @Volatile
    private var listener: SpeechEngine.Listener? = null

    override fun start(request: RecognitionRequest, listener: SpeechEngine.Listener) {
        this.listener = listener
        recognizer.setRecognitionListener(PlatformListener())
        recognizer.startListening(buildIntent(request))
    }

    override fun cancel() {
        try {
            recognizer.cancel()
        } catch (_: Exception) {
        }
    }

    override fun destroy() {
        listener = null
        try {
            recognizer.destroy()
        } catch (_: Exception) {
        }
    }

    private fun buildIntent(request: RecognitionRequest): Intent =
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
            )
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, request.languageTag)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            if (request.preferOffline) {
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            }
            if (Build.VERSION.SDK_INT >= 33) {
                putExtra(
                    RecognizerIntent.EXTRA_ENABLE_FORMATTING,
                    RecognizerIntent.FORMATTING_OPTIMIZE_QUALITY,
                )
            }
        }

    private inner class PlatformListener : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) = Unit
        override fun onBeginningOfSpeech() = Unit
        override fun onRmsChanged(rmsdB: Float) = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() = Unit
        override fun onEvent(eventType: Int, params: Bundle?) = Unit

        override fun onPartialResults(partialResults: Bundle?) {
            val text = firstResult(partialResults) ?: return
            listener?.onPartial(text)
        }

        override fun onResults(results: Bundle?) {
            val text = firstResult(results).orEmpty()
            listener?.onFinal(text)
        }

        override fun onError(error: Int) {
            val kind = when (error) {
                SpeechRecognizer.ERROR_CLIENT -> SpeechEngine.ErrorKind.CANCELLED
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> SpeechEngine.ErrorKind.PERMISSION
                SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED,
                SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE,
                -> SpeechEngine.ErrorKind.LANGUAGE
                else -> SpeechEngine.ErrorKind.FAILED
            }
            listener?.onError(kind)
        }

        private fun firstResult(bundle: Bundle?): String? {
            val list = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            return list?.firstOrNull()?.takeIf { it.isNotBlank() }
        }
    }
}

internal class DictationAudioFocusGate(
    context: Context,
) : DictationAudioFocus {
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var focusRequest: AudioFocusRequest? = null

    private val attributes: AudioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

    override fun request(onInterrupted: () -> Unit): Boolean {
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            .setAudioAttributes(attributes)
            .setOnAudioFocusChangeListener { change ->
                when (change) {
                    AudioManager.AUDIOFOCUS_LOSS,
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK,
                    -> onInterrupted()
                }
            }
            .build()
        focusRequest = request
        return audioManager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    override fun abandon() {
        val request = focusRequest ?: return
        focusRequest = null
        audioManager.abandonAudioFocusRequest(request)
    }
}
