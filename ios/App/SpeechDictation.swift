// Modified for StartupBot; original copyright and license retained.
// On-device speech recognition avoids transmitting audio to Apple when supported.
import AVFoundation
import Combine
import Speech
import CompanionCore
import SwiftUI

@MainActor
final class SpeechDictation: ObservableObject {
    private static let cancellationCodes: [String: Set<Int>] = [
        "kLSRErrorDomain": [209, 216],
        "kAFAssistantErrorDomain": [216],
    ]

    @Published private(set) var isListening = false
    /// True from `start` until capture is running or the attempt fails.
    /// Publishing it keeps the frozen composer base protected while the
    /// system permission sheets are still in flight.
    @Published private(set) var isStarting = false
    @Published private(set) var transcript = ""
    @Published private(set) var error: LocalizedStringKey?

    private(set) var base = ""

    private var recognizer: SFSpeechRecognizer?
    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var tapInstalled = false
    private var stopping = false
    /// Bumped on every start/stop so an authorization that finishes after
    /// the user already cancelled cannot open the mic.
    private var generation = 0
    private var startTask: Task<Void, Never>?

    func toggle(capturing base: String) {
        if isListening || isStarting {
            stop()
        } else {
            start(base: base)
        }
    }

    private func start(base: String) {
        guard !isListening, !isStarting else { return }
        error = nil
        self.base = base.trimmingCharacters(in: .whitespacesAndNewlines)
        transcript = ""
        isStarting = true
        generation += 1
        let gen = generation
        startTask = Task { await actuallyStart(generation: gen) }
    }

    func stop() {
        startTask?.cancel()
        startTask = nil
        generation += 1
        isStarting = false
        stopping = true
        isListening = false
        teardown()
    }

    // MARK: - Authorization

    private func actuallyStart(generation gen: Int) async {
        let speech = await requestSpeechAuthorization()
        guard gen == generation, !Task.isCancelled else {
            return
        }
        guard speech == .authorized else {
            isStarting = false
            error = Self.speechDeniedMessage
            return
        }

        let mic = await AVAudioApplication.requestRecordPermission()
        guard gen == generation, !Task.isCancelled else {
            return
        }
        guard mic else {
            isStarting = false
            error = Self.micDeniedMessage
            return
        }

        do {
            try beginCapture(generation: gen)
            isStarting = false
        } catch CaptureError.noRecognizer {
            isStarting = false
            error = "Dictation isn't available for this language."
            teardown()
        } catch {
            isStarting = false
            self.error = "Couldn't start the microphone."
            teardown()
        }
    }

    private func requestSpeechAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
    }


    private func beginCapture(generation gen: Int) throws {
        let recognizer = Dictation.localeCandidates()
            .compactMap { SFSpeechRecognizer(locale: $0) }
            .first { $0.isAvailable }
        guard let recognizer else {
            throw CaptureError.noRecognizer
        }
        self.recognizer = recognizer

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement)
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let engine = AVAudioEngine()
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.addsPunctuation = true
        request.taskHint = .dictation
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }

        audioEngine = engine
        recognitionRequest = request

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.channelCount > 0 else {
            throw CaptureError.silentInput
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }
        tapInstalled = true
        engine.prepare()
        try engine.start()

        stopping = false
        isListening = true

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, recognitionError in
            Task { @MainActor in
                self?.handle(
                    result: result,
                    recognitionError: recognitionError,
                    generation: gen
                )
            }
        }
    }

    private func handle(
        result: SFSpeechRecognitionResult?,
        recognitionError: Error?,
        generation gen: Int
    ) {
        guard gen == generation, !stopping, isListening else { return }
        if let result {
            transcript = Dictation.updateTranscript(transcript, new: result.bestTranscription.formattedString)
            if result.isFinal {
                stop()
                return
            }
        }
        guard let recognitionError else { return }
        let ns = recognitionError as NSError
        if Self.cancellationCodes[ns.domain]?.contains(ns.code) == true {
            stop()
            return
        }
        self.error = "Couldn't transcribe that."
        stop()
    }

    private func teardown() {
        if let engine = audioEngine {
            if tapInstalled {
                engine.inputNode.removeTap(onBus: 0)
                tapInstalled = false
            }
            if engine.isRunning { engine.stop() }
        }
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        audioEngine = nil
        recognizer = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private enum CaptureError: Error {
        case silentInput
        case noRecognizer
    }

    static let speechDeniedMessage: LocalizedStringKey =
        "Dictation needs Speech Recognition access. Enable it in Settings → StartupBot."
    static let micDeniedMessage: LocalizedStringKey =
        "Dictation needs Microphone access. Enable it in Settings → StartupBot."
}
