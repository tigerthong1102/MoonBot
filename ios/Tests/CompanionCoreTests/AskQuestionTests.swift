import Foundation
import XCTest
@testable import CompanionCore

final class AskQuestionTests: XCTestCase {
    private func request() throws -> QuestionRequestCardData {
        try JSONDecoder().decode(QuestionRequestCardData.self, from: Data("""
        {"version":1,"questions":[
          {"question":"Plans?","multiSelect":true,"custom":false,"options":[{"label":"Basic"},{"label":"Pro"}]},
          {"question":"When?","options":[{"label":"Today"},{"label":"Tomorrow"}]}
        ]}
        """.utf8))
    }

    func testEveryQuestionMustHaveAnAnswerAndMultipleSelectionsSurvive() throws {
        let request = try request()
        var form = QuestionAnswerForm()
        XCTAssertNil(form.answer(in: request))
        form.choose("Basic", at: 0, in: request)
        form.choose("Pro", at: 0, in: request)
        XCTAssertNil(form.answer(in: request))
        form.choose("Today", at: 1, in: request)
        XCTAssertEqual(form.answer(in: request), "The user answered your questions.\n\nQ: Plans?\nA: Basic, Pro\n\nQ: When?\nA: Today")
        form.choose("Pro", at: 0, in: request)
        XCTAssertEqual(form.selected[0], ["Basic"])
        form.choose("Tomorrow", at: 1, in: request)
        XCTAssertEqual(form.selected[1], ["Tomorrow"])
    }

    func testCustomPolicyAndAnswerLimitsAreEnforced() throws {
        let request = try request()
        var form = QuestionAnswerForm()
        form.setCustom("cannot invent an option", at: 0, in: request)
        XCTAssertNil(form.custom[0])
        form.choose("Basic", at: 0, in: request)
        form.choose("Today", at: 1, in: request)
        form.setCustom("Next week", at: 1, in: request)
        XCTAssertTrue(form.selected[1]?.isEmpty == true)
        XCTAssertTrue(form.answer(in: request)?.hasSuffix("A: Next week") == true)
        form.setCustom(String(repeating: "x", count: 2_001), at: 1, in: request)
        XCTAssertNil(form.answer(in: request))
        form.choose("not offered", at: 0, in: request)
        XCTAssertEqual(form.selected[0], ["Basic"])
    }

    func testFreeTextOnlyAndUnknownVersionsAreHandledConservatively() throws {
        let free = try JSONDecoder().decode(QuestionRequestCardData.self, from: Data("{\"version\":1,\"questions\":[{\"question\":\"Notes?\"}]}".utf8))
        var form = QuestionAnswerForm()
        form.setCustom("done", at: 0, in: free)
        XCTAssertNotNil(form.answer(in: free))
        var unknown = free
        unknown.version = 2
        XCTAssertNil(form.answer(in: unknown))
        unknown.version = 1
        unknown.questions = Array(repeating: free.questions[0], count: 7)
        XCTAssertNil(form.answer(in: unknown))
    }

    func testQuestionCardsNeverBecomePermissionGrantsEvenWhenTheyNameATool() throws {
        let card = try JSONDecoder().decode(OptionCard.self, from: Data("""
        {"title":"Questions","subtitle":"","options":[],"requestId":"ask","tool":"AskUserQuestion","requestType":"question","allowKey":"must-not-grant","questionRequest":{"version":1,"questions":[{"question":"Notes?","options":[]}]}}
        """.utf8))
        XCTAssertTrue(card.isPending)
        XCTAssertFalse(card.isPermission)
        XCTAssertFalse(card.shouldRememberPermission(for: "Always allow"))
        XCTAssertEqual(card.responseBehavior(for: "anything"), "answer")
    }

    func testFormatterMatchesCanonicalPhoneProtocolVectors() throws {
        struct Vector: Decodable { var request: QuestionRequestCardData; var answers: [[String]]; var formatted: String }
        let url = try XCTUnwrap(Bundle.module.url(forResource: "question-answer-v1", withExtension: "json", subdirectory: "Fixtures"))
        let vectors = try JSONDecoder().decode([Vector].self, from: Data(contentsOf: url))
        XCTAssertGreaterThanOrEqual(vectors.count, 4)
        for vector in vectors {
            XCTAssertEqual(QuestionAnswerForm.format(questions: vector.request.questions, answers: vector.answers), vector.formatted)
            XCTAssertFalse(QuestionAnswerForm.display(vector.formatted).hasPrefix("The user answered"))
        }
    }
}
