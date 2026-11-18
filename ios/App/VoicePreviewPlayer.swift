import AVFAudio
import Combine
import Foundation

@MainActor
final class VoicePreviewPlayer: NSObject, ObservableObject, AVAudioPlayerDelegate {
    private(set) var player: AVAudioPlayer?
    private var generation = 0
    private var active = false
    private let activate: () throws -> Void
    private let deactivate: () -> Void
    private let start: (AVAudioPlayer) -> Bool

    init(
        activate: @escaping () throws -> Void = {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio)
            try session.setActive(true)
        },
        deactivate: @escaping () -> Void = {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        },
        start: @escaping (AVAudioPlayer) -> Bool = { $0.prepareToPlay() && $0.play() }
    ) {
        self.activate = activate
        self.deactivate = deactivate
        self.start = start
        super.init()
    }

    func begin() -> Int {
        stop()
        return generation
    }

    func isCurrent(_ request: Int) -> Bool { generation == request }

    func play(_ data: Data, request: Int) throws {
        guard isCurrent(request) else { return }
        do {
            try activate()
            active = true
            let next = try AVAudioPlayer(data: data)
            player = next
            next.delegate = self
            guard start(next) else { throw PlaybackError.unavailable }
        } catch {
            stop()
            throw error
        }
    }

    func stop() {
        generation += 1
        player?.delegate = nil
        player?.stop()
        player = nil
        if active {
            active = false
            deactivate()
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        release(ObjectIdentifier(player))
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        release(ObjectIdentifier(player))
    }

    nonisolated private func release(_ identifier: ObjectIdentifier) {
        Task { @MainActor [weak self] in
            guard let self, self.player.map({ ObjectIdentifier($0) }) == identifier else { return }
            self.stop()
        }
    }

    enum PlaybackError: Error { case unavailable }
}
