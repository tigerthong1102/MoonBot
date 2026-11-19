// Modified for StartupBot; original copyright and license retained.
import Foundation
import SwiftUI

enum AppLanguage: String, CaseIterable, Identifiable {
    case system
    case english = "en"
    case vietnamese = "vi"
    case portugueseBrazil = "pt-BR"

    var id: String { rawValue }

    var label: LocalizedStringKey {
        switch self {
        case .system: "Follow the system"
        case .english: "English"
        case .vietnamese: "Tiếng Việt"
        case .portugueseBrazil: "Português (Brasil)"
        }
    }

    var locale: Locale? {
        self == .system ? nil : Locale(identifier: rawValue)
    }

    static func message(_ resource: LocalizedStringResource) -> String {
        var localized = resource
        let preference = UserDefaults.standard.string(forKey: PrefKey.language) ?? system.rawValue
        localized.locale = resolved(preference).locale ?? .autoupdatingCurrent
        return String(localized: localized)
    }

    static func resolved(_ stored: String) -> AppLanguage {
        AppLanguage(rawValue: stored) ?? .system
    }
}
