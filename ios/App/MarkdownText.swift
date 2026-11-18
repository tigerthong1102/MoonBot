// Modified for StartupBot; original copyright and license retained.
import SwiftUI
import CompanionCore

struct MarkdownText: View {
    let source: String
    var caret: Bool = false
    var openLink: ((URL) -> OpenURLAction.Result)?

    init(
        source: String,
        caret: Bool = false,
        openLink: ((URL) -> OpenURLAction.Result)? = nil
    ) {
        self.source = source
        self.caret = caret
        self.openLink = openLink
    }

    var body: some View {
        let blocks = Markdown.blocks(source)
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { item in
                view(for: item.element, tail: caret && item.offset == blocks.count - 1)
            }
        }
        .environment(\.openURL, OpenURLAction { url in
            openLink?(url) ?? .systemAction(url)
        })
    }

    @ViewBuilder
    private func view(for block: MarkdownBlock, tail: Bool) -> some View {
        switch block {
        case let .paragraph(text):
            inline(text, tail: tail)
                .font(.system(size: 17))
                .fixedSize(horizontal: false, vertical: true)

        case let .heading(level, text):
            inline(text, tail: tail)
                .font(.system(size: level <= 1 ? 21 : level == 2 ? 19 : 17, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)

        case let .bullet(indent, text):
            marker("•", indent: indent, text: text, tail: tail)

        case let .ordered(indent, number, text):
            marker("\(number).", indent: indent, text: text, tail: tail)

        case let .quote(text):
            HStack(alignment: .top, spacing: 8) {
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(Color.secondary.opacity(0.4))
                    .frame(width: 3)
                inline(text, tail: tail)
                    .font(.system(size: 17))
                    .foregroundStyle(Color.secondary)
            }
            .fixedSize(horizontal: false, vertical: true)

        case let .code(language, text):
            VStack(alignment: .leading, spacing: 4) {
                if let language, !language.isEmpty {
                    Text(language)
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(Color.secondary)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    (Text(text) + caretText(tail))
                        .font(.system(size: 14, design: .monospaced))
                        .textSelection(.enabled)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.secondary.opacity(0.14))
            )

        case .rule:
            Divider().padding(.vertical, 2)
        }
    }

    private func marker(_ symbol: String, indent: Int, text: String, tail: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(symbol)
                .font(.system(size: 17))
                .foregroundStyle(Color.secondary)
                .frame(minWidth: 16, alignment: .trailing)
            inline(text, tail: tail).font(.system(size: 17))
        }
        .padding(.leading, CGFloat(indent) * 14)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func inline(_ text: String, tail: Bool = false) -> Text {
        let rendered: Text
        if let attributed = try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            rendered = Text(attributed)
        } else {
            rendered = Text(text)
        }
        return rendered + caretText(tail)
    }

    private func caretText(_ tail: Bool) -> Text {
        tail ? Text("\u{2007}▍").foregroundStyle(Color.secondary) : Text("")
    }
}
