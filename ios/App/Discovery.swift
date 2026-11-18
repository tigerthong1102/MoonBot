// Modified for StartupBot; original copyright and license retained.
// iOS Bonjour browsing requires NSLocalNetworkUsageDescription and NSBonjourServices.
import Foundation
import Network
import CompanionCore
import SwiftUI

@MainActor
final class Discovery: ObservableObject {
    struct Found: Identifiable, Hashable {
        let name: String
        let endpoint: NWEndpoint

        var id: String { name }
    }

    @Published private(set) var found: [Found] = []
    @Published private(set) var browsing = false
    @Published private(set) var failure: LocalizedStringKey?

    private var browser: NWBrowser?
    private var retryTask: Task<Void, Never>?
    private var retryCount = 0
    private var generation = 0
    private var shouldBrowse = false

    func start() {
        guard !shouldBrowse else { return }
        shouldBrowse = true
        retryCount = 0
        startBrowser()
    }

    private func startBrowser() {
        guard shouldBrowse, browser == nil else { return }
        retryTask = nil
        generation += 1
        let currentGeneration = generation
        let parameters = NWParameters()
        parameters.includePeerToPeer = false
        let browser = NWBrowser(
            for: .bonjour(type: "_openmausbot._tcp", domain: nil),
            using: parameters
        )

        browser.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self, self.generation == currentGeneration else { return }
                switch state {
                case .ready:
                    self.retryCount = 0
                    self.browsing = true
                    self.failure = nil
                case let .waiting(error):
                    self.browsing = false
                    self.failure = Self.failureMessage(for: error)
                case let .failed(error):
                    self.handleFailure(error)
                case .cancelled:
                    self.browsing = false
                default:
                    break
                }
            }
        }

        browser.browseResultsChangedHandler = { [weak self] results, _ in
            let found = results.compactMap { result -> Found? in
                guard case let .service(name, _, _, _) = result.endpoint else { return nil }
                return Found(name: name, endpoint: result.endpoint)
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            Task { @MainActor in self?.found = found }
        }

        self.browser = browser
        browser.start(queue: .main)
    }

    func stop() {
        shouldBrowse = false
        retryTask?.cancel()
        retryTask = nil
        generation += 1
        browser?.cancel()
        browser = nil
        browsing = false
    }

    private func handleFailure(_ error: NWError) {
        browser?.cancel()
        browser = nil
        browsing = false
        found = []

        guard Self.isDefunct(error), retryCount < 3, shouldBrowse else {
            failure = Self.failureMessage(for: error)
            return
        }

        retryCount += 1
        failure = "Local discovery was interrupted. Retrying…"
        let delay = UInt64(retryCount) * 350_000_000
        retryTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: delay)
            guard !Task.isCancelled else { return }
            await MainActor.run { self?.startBrowser() }
        }
    }

    private static func isDefunct(_ error: NWError) -> Bool {
        guard case let .dns(code) = error else { return false }
        return Int(code) == kDNSServiceErr_DefunctConnection
    }

    private static func failureMessage(for error: NWError) -> LocalizedStringKey {
        if case let .dns(code) = error,
           Int(code) == kDNSServiceErr_PolicyDenied {
            return "Local Network access is off. Enable it in Settings, or enter a Tailscale address below."
        }
        return "Local discovery isn't available right now. Enter the address shown in Phone settings."
    }

    func resolve(_ service: Found) async throws -> Connection {
        let connection = NWConnection(to: service.endpoint, using: .tcp)
        defer { connection.cancel() }

        let resolved: NWEndpoint = try await withCheckedThrowingContinuation { continuation in
            var settled = false
            let finish: (Result<NWEndpoint, Error>) -> Void = { result in
                guard !settled else { return }
                settled = true
                continuation.resume(with: result)
            }

            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    if let endpoint = connection.currentPath?.remoteEndpoint {
                        finish(.success(endpoint))
                    } else {
                        finish(.failure(APIError.transport("Couldn't work out that computer's address.")))
                    }
                case let .failed(error):
                    finish(.failure(APIError.transport(error.localizedDescription)))
                case .cancelled:
                    finish(.failure(APIError.transport("Connection cancelled.")))
                default:
                    break
                }
            }
            connection.start(queue: .main)
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
                finish(.failure(APIError.transport("That computer didn't answer.")))
            }
        }

        guard case let .hostPort(host, port) = resolved else {
            throw APIError.transport("Couldn't work out that computer's address.")
        }
        return Connection(name: service.name, host: Self.plainHost(host), port: Int(port.rawValue))
    }

    static func plainHost(_ host: NWEndpoint.Host) -> String {
        Connection.urlHost("\(host)")
    }
}
