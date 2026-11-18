import Foundation
import XCTest
@testable import CompanionCore

final class SkillReferenceTests: XCTestCase {
    private func proposal() throws -> SkillRequestCardData {
        try JSONDecoder().decode(SkillRequestCardData.self, from: Data("""
        {"version":1,"requestId":"r","botId":"b","threadId":"t","stagedId":"s","action":"create","name":"Fixture","gist":"Fixture","preview":"SKILL.md content","sha256":"\(String(repeating: "a", count: 64))","warnings":[],"createdAt":1,"references":[{"path":"references/rules.md","content":"Sensitive reference instructions"}],"referencesSha256":"\(String(repeating: "b", count: 64))"}
        """.utf8))
    }

    func testCompleteReferencesSurviveDecodingForReview() throws {
        let card = try proposal()
        XCTAssertEqual(card.references?.first?.path, "references/rules.md")
        XCTAssertEqual(card.references?.first?.content, "Sensitive reference instructions")
        XCTAssertEqual(card.reviewedSha256, String(repeating: "a", count: 64))
        XCTAssertEqual(try JSONDecoder().decode(SkillRequestCardData.self, from: JSONEncoder().encode(card)), card)
    }

    func testIncompleteReferencesCannotBeApproved() throws {
        let valid = try proposal()
        var card = valid
        card.references = nil
        XCTAssertNil(card.reviewedSha256)
        card = valid; card.referencesSha256 = nil
        XCTAssertNil(card.reviewedSha256)
        card = valid; card.referencesSha256 = "invalid"
        XCTAssertNil(card.reviewedSha256)
        card = valid; card.references = valid.references! + valid.references!
        XCTAssertNil(card.reviewedSha256)
        card = valid; card.references = [SkillReferenceFile(path: "../hidden", content: "bad")]
        XCTAssertNil(card.reviewedSha256)
        card.references = nil; card.referencesSha256 = nil
        XCTAssertEqual(card.reviewedSha256, valid.sha256)
    }
}
