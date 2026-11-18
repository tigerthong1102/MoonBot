// Modified for StartupBot; original copyright and license retained.

import Foundation

public enum Dictation {
    private static let maximumPreferredLanguages = 3

    public static func draft(base: String, transcript: String) -> String {
        let typed = base.trimmingCharacters(in: .whitespacesAndNewlines)
        let spoken = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        if spoken.isEmpty { return typed }
        if typed.isEmpty { return spoken }
        return "\(typed) \(spoken)"
    }

    public static func updateTranscript(_ current: String, new: String) -> String {
        let current = current.trimmingCharacters(in: .whitespacesAndNewlines)
        let new = new.trimmingCharacters(in: .whitespacesAndNewlines)
        if new.isEmpty { return current }
        if current.isEmpty { return new }

        if new.hasPrefix(current) { return new }

        if current.hasPrefix(new) { return current }

        let currentWords = current.split(separator: " ")
        let newWords = new.split(separator: " ")
        let commonWordCount = zip(currentWords, newWords)
            .prefix(while: { $0.lowercased() == $1.lowercased() })
            .count
        if commonWordCount >= 2, commonWordCount * 2 >= currentWords.count {
            return new
        }

        return draft(base: current, transcript: new)
    }

    public static func localeCandidates(
        preferredLanguages: [String] = Locale.preferredLanguages,
        current: Locale = .current
    ) -> [Locale] {
        var seen = Set<String>()
        var result: [Locale] = []
        func add(_ locale: Locale) {
            let key = canonicalIdentifier(locale)
            guard seen.insert(key).inserted else { return }
            result.append(locale)
        }
        for language in preferredLanguages.prefix(maximumPreferredLanguages) {
            add(Locale(identifier: language))
        }
        add(current)
        add(Locale(identifier: "en-US"))
        return result
    }

    public static func canonicalIdentifier(_ locale: Locale) -> String {
        locale.identifier.lowercased().replacingOccurrences(of: "-", with: "_")
    }
}
