// Modified for StartupBot; original copyright and license retained.
import Foundation

public enum ComposerKeyboard {
    public static func shouldSubmit(previousText: String, proposedText: String) -> Bool {
        let changes = proposedText.difference(from: previousText)
        var insertedLineBreaks = 0

        for change in changes {
            guard case let .insert(_, character, _) = change else { continue }
            guard isLineBreak(character) else { return false }
            insertedLineBreaks += 1
        }
        return insertedLineBreaks == 1
    }

    private static func isLineBreak(_ character: Character) -> Bool {
        !character.unicodeScalars.isEmpty
            && character.unicodeScalars.allSatisfy(CharacterSet.newlines.contains)
    }
}
