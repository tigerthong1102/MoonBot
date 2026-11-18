#if DEBUG && targetEnvironment(simulator)
import Foundation

@MainActor
enum StartupBotInternalProbe {
    private static var ran = false
    static func runIfRequested() {
        guard !ran, ProcessInfo.processInfo.arguments.contains("--startupbot-internal-security-smoke") else { return }
        ran = true
        let connection = "startupbot-internal-canary-\(UUID().uuidString)"
        let canary = UUID().uuidString
        var report: [String: String] = ["status": "FAIL"]
        do {
            try Keychain.save(canary, for: connection)
            guard try Keychain.token(for: connection) == canary else { throw ProbeError.keychain }
            guard Keychain.remove(connection), try Keychain.token(for: connection) == nil else { throw ProbeError.keychain }
            guard let group = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: OpenMausSharedConfiguration.appGroupIdentifier) else { throw ProbeError.appGroup }
            let file = group.appendingPathComponent(connection)
            defer { try? FileManager.default.removeItem(at: file) }
            let payload = Data("StartupBot internal group canary".utf8)
            try payload.write(to: file, options: .atomic)
            guard try Data(contentsOf: file) == payload else { throw ProbeError.appGroup }
            report = ["status": "PASS", "keychain": "PASS", "appGroup": "PASS"]
        } catch {
            _ = Keychain.remove(connection)
            report["error"] = error.localizedDescription
        }
        if let destination = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
           let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: destination.appendingPathComponent("startupbot-security-smoke.json"), options: .atomic)
        }
    }
    private enum ProbeError: Error { case keychain, appGroup }
}
#endif
