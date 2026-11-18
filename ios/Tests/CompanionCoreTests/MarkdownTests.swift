// Modified for StartupBot; original copyright and license retained.
import XCTest
@testable import CompanionCore

final class MarkdownTests: XCTestCase {
    func testPlainTextIsOneParagraph() {
        XCTAssertEqual(Markdown.blocks("just a reply"), [.paragraph("just a reply")])
    }

    func testEmptyInputProducesNothing() {
        XCTAssertEqual(Markdown.blocks(""), [])
        XCTAssertEqual(Markdown.blocks("\n\n  \n"), [])
    }

    func testSoftBreaksBecomeSpaces() {
        XCTAssertEqual(
            Markdown.blocks("one line\nand its continuation"),
            [.paragraph("one line and its continuation")]
        )
    }

    func testBlankLineSeparatesParagraphs() {
        XCTAssertEqual(
            Markdown.blocks("first\n\nsecond"),
            [.paragraph("first"), .paragraph("second")]
        )
    }


    func testHeadingLevels() {
        XCTAssertEqual(Markdown.blocks("# Title"), [.heading(level: 1, text: "Title")])
        XCTAssertEqual(Markdown.blocks("### Deeper"), [.heading(level: 3, text: "Deeper")])
    }

    func testHashWithoutSpaceIsNotAHeading() {
        XCTAssertEqual(Markdown.blocks("#hashtag"), [.paragraph("#hashtag")])
        XCTAssertEqual(Markdown.blocks("####### seven"), [.paragraph("####### seven")])
    }


    func testBulletMarkers() {
        XCTAssertEqual(
            Markdown.blocks("- one\n* two\n+ three"),
            [
                .bullet(indent: 0, text: "one"),
                .bullet(indent: 0, text: "two"),
                .bullet(indent: 0, text: "three"),
            ]
        )
    }

    func testNestedBulletsCountIndent() {
        XCTAssertEqual(
            Markdown.blocks("- top\n  - nested\n    - deeper"),
            [
                .bullet(indent: 0, text: "top"),
                .bullet(indent: 1, text: "nested"),
                .bullet(indent: 2, text: "deeper"),
            ]
        )
    }

    func testOrderedListsKeepTheirNumbers() {
        XCTAssertEqual(
            Markdown.blocks("1. first\n2. second\n10) tenth"),
            [
                .ordered(indent: 0, number: 1, text: "first"),
                .ordered(indent: 0, number: 2, text: "second"),
                .ordered(indent: 0, number: 10, text: "tenth"),
            ]
        )
    }

    func testNumberWithoutDelimiterIsProse() {
        XCTAssertEqual(Markdown.blocks("2026 was the year"), [.paragraph("2026 was the year")])
        XCTAssertEqual(Markdown.blocks("3.14 is pi"), [.paragraph("3.14 is pi")])
    }

    /// Inline emphasis is Foundation's job, not this one — the splitter must
    /// hand the markers through untouched or the view has nothing to render.
    func testInlineSyntaxSurvivesTheSplit() {
        XCTAssertEqual(
            Markdown.blocks("- **bold** and `code` and [link](https://x.test)"),
            [.bullet(indent: 0, text: "**bold** and `code` and [link](https://x.test)")]
        )
    }


    func testFencedCodeKeepsItsLanguageAndItsWhitespace() {
        XCTAssertEqual(
            Markdown.blocks("```swift\nlet x = 1\n    indented\n```"),
            [.code(language: "swift", text: "let x = 1\n    indented")]
        )
    }

    func testFenceWithoutLanguage() {
        XCTAssertEqual(Markdown.blocks("```\nplain\n```"), [.code(language: nil, text: "plain")])
    }

    func testUnclosedFenceRunsToTheEnd() {
        XCTAssertEqual(
            Markdown.blocks("here:\n```py\nprint(1)"),
            [.paragraph("here:"), .code(language: "py", text: "print(1)")]
        )
    }

    func testFenceContentIsNotReparsed() {
        XCTAssertEqual(
            Markdown.blocks("```\n# not a heading\n- not a bullet\n```"),
            [.code(language: nil, text: "# not a heading\n- not a bullet")]
        )
    }


    func testQuote() {
        XCTAssertEqual(Markdown.blocks("> quoted"), [.quote("quoted")])
    }

    func testHorizontalRules() {
        XCTAssertEqual(Markdown.blocks("---"), [.rule])
        XCTAssertEqual(Markdown.blocks("***"), [.rule])
        XCTAssertEqual(Markdown.blocks("___"), [.rule])
    }

    func testRuleNeedsThreeAndNothingElse() {
        XCTAssertEqual(Markdown.blocks("--"), [.paragraph("--")])
        XCTAssertEqual(Markdown.blocks("-- dashes --"), [.paragraph("-- dashes --")])
    }

    func testPartialInputAlwaysRendersSomething() {
        for prefix in ["#", "# ", "# Head", "- ", "- it", "**bo", "```", "```sw\nlet", "[link](htt"] {
            XCTAssertFalse(
                Markdown.blocks(prefix).isEmpty,
                "dropped everything for \(prefix.debugDescription)"
            )
        }
    }

    func testNoPrefixOfAReplyLosesCharacters() {
        let reply = "# Result\n\nRan **two** checks:\n\n- `pnpm test` passed\n- `pnpm lint` passed\n\n```sh\npnpm test\n```\n\n> nothing else to report"
        for length in 1...reply.count {
            let partial = String(reply.prefix(length))
            let rendered = Markdown.blocks(partial).map(text).joined()
            let sent = partial.filter { !$0.isWhitespace && !"#->`*_".contains($0) }
            let shown = rendered.filter { !$0.isWhitespace && !"#->`*_".contains($0) }
            XCTAssertEqual(shown, sent, "lost content at \(length) characters")
        }
    }

    private func text(_ block: MarkdownBlock) -> String {
        switch block {
        case let .paragraph(text): return text
        case let .bullet(_, text): return text
        case let .ordered(_, number, text): return "\(number)" + text
        case let .heading(_, text): return text
        case let .code(language, text): return (language ?? "") + text
        case let .quote(text): return text
        case .rule: return ""
        }
    }
}
