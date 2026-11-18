// Modified for StartupBot; original copyright and license retained.
import Foundation
import SwiftUI

enum AppLanguage: String, CaseIterable, Identifiable {
    case system
    case english = "en"
    case portugueseBrazil = "pt-BR"

    var id: String { rawValue }

    var label: LocalizedStringKey {
        switch self {
        case .system: "Follow the system"
        case .english: "English"
        case .portugueseBrazil: "Português (Brasil)"
        }
    }

    /// `nil` follows the system: the environment keeps the locale SwiftUI
    /// already handed it, so no choice here means no behaviour change.
    var locale: Locale? {
        self == .system ? nil : Locale(identifier: rawValue)
    }

    static func resolved(_ stored: String) -> AppLanguage {
        AppLanguage(rawValue: stored) ?? .system
    }
}
