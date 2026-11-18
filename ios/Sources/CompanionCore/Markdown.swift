// Modified for StartupBot; original copyright and license retained.
// Markdown, split into blocks.
//
// The desktop renders bot replies with react-markdown + GFM. The phone was
// showing the source: `**bold**`, `- ` bullets and `[text](url)` arriving as
// literal characters, which is worse than no markdown at all — it is the
// author's intent visible but not applied.
//
// Foundation can already do the *inline* half. `AttributedString(markdown:)`
// handles emphasis, code spans, strikethrough and links, and SwiftUI renders
// the links tappable for free. What it will not do is lay out blocks: with
// `.full` it records a presentation intent and leaves you to draw the bullet,
// the indent and the spacing yourself. So this splits the text into blocks
// and the view draws each one, handing the inline run back to Foundation.
//
// Deliberately not a full CommonMark implementation. It covers what a model
// actually emits into a chat bubble — paragraphs, lists, headings, fences,
// quotes, rules — and treats anything it does not recognise as text, which is
// the failure mode that loses nothing.
import Foundation

public enum MarkdownBlock: Equatable, Sendable {
    case paragraph(String)
    case bullet(indent: Int, text: String)
    case ordered(indent: Int, number: Int, text: String)
    case heading(level: Int, text: String)
    case code(language: String?, text: String)
    case quote(String)
    case rule
}

public enum Markdown {
    public static func blocks(_ source: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []

        func flushParagraph() {
            guard !paragraph.isEmpty else { return }
            blocks.append(.paragraph(paragraph.joined(separator: " ")))
            paragraph.removeAll()
        }

        let normalised = source.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        var lines = normalised.components(separatedBy: "\n")[...]
        while let line = lines.first {
            lines = lines.dropFirst()
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                flushParagraph()
                let marker = String(trimmed.prefix(3))
                let language = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                var body: [String] = []
                while let next = lines.first {
                    lines = lines.dropFirst()
                    if next.trimmingCharacters(in: .whitespaces).hasPrefix(marker) { break }
                    body.append(next)
                }
                blocks.append(.code(language: language.isEmpty ? nil : language, text: body.joined(separator: "\n")))
                continue
            }

            if trimmed.isEmpty {
                flushParagraph()
                continue
            }

            if trimmed.count >= 3, "-*_".contains(trimmed.first!),
               trimmed.allSatisfy({ $0 == trimmed.first! }) {
                flushParagraph()
                blocks.append(.rule)
                continue
            }

            if let heading = heading(trimmed) {
                flushParagraph()
                blocks.append(heading)
                continue
            }

            if trimmed.hasPrefix(">") {
                flushParagraph()
                blocks.append(.quote(String(trimmed.dropFirst()).trimmingCharacters(in: .whitespaces)))
                continue
            }

            if let item = listItem(line) {
                flushParagraph()
                blocks.append(item)
                continue
            }

            paragraph.append(trimmed)
        }
        flushParagraph()
        return blocks
    }

    private static func heading(_ trimmed: String) -> MarkdownBlock? {
        let hashes = trimmed.prefix(while: { $0 == "#" }).count
        guard hashes >= 1, hashes <= 6 else { return nil }
        let rest = String(trimmed.dropFirst(hashes))
        guard rest.hasPrefix(" ") else { return nil }
        return .heading(level: hashes, text: rest.trimmingCharacters(in: .whitespaces))
    }

    private static func listItem(_ line: String) -> MarkdownBlock? {
        let leading = line.prefix(while: { $0 == " " || $0 == "\t" }).count
        let indent = min(leading / 2, 4)
        let trimmed = line.trimmingCharacters(in: .whitespaces)

        for marker in ["- ", "* ", "+ "] where trimmed.hasPrefix(marker) {
            return .bullet(indent: indent, text: String(trimmed.dropFirst(2)))
        }

        let digits = trimmed.prefix(while: \.isNumber)
        if !digits.isEmpty, digits.count <= 9 {
            let rest = trimmed.dropFirst(digits.count)
            if rest.hasPrefix(". ") || rest.hasPrefix(") ") {
                return .ordered(indent: indent, number: Int(digits) ?? 1, text: String(rest.dropFirst(2)))
            }
        }
        return nil
    }
}
