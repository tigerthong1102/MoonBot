// Modified for StartupBot; original copyright and license retained.
import Foundation

enum OpenMausSharedConfiguration {
    static let appGroupIdentifier = "group.ai.startupbot.shared"
    static let legacyAppBundleIdentifier = "ai.startupbot.ios"
    static let keychainAccessGroupInfoKey = "OpenMausKeychainAccessGroup"

    static var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: appGroupIdentifier)
    }

    static var keychainAccessGroup: String? {
        guard let value = Bundle.main.object(
            forInfoDictionaryKey: keychainAccessGroupInfoKey
        ) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("$(") else { return nil }
        return trimmed
    }

    /// Apple Keychain access-group names include the application signing prefix.
    static var legacyAppKeychainAccessGroup: String? {
        guard let shared = keychainAccessGroup,
              shared.hasSuffix(appGroupIdentifier) else { return nil }
        let prefix = shared.dropLast(appGroupIdentifier.count)
        return "\(prefix)\(legacyAppBundleIdentifier)"
    }
}
