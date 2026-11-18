import Foundation
import XCTest
@testable import CompanionCore

final class RequestTrustTests: XCTestCase {
    func testEveryRedirectRefusesToForwardTheAuthenticatedRequest() throws {
        let origin = try XCTUnwrap(URL(string: "https://fixture.example/api/bots"))
        var target = URLRequest(url: try XCTUnwrap(URL(string: "http://other.example/unapproved")))
        target.setValue("Bearer fixture-only", forHTTPHeaderField: "Authorization")
        for status in [301, 302, 303, 307, 308] {
            let response = try XCTUnwrap(HTTPURLResponse(url: origin, statusCode: status, httpVersion: nil, headerFields: nil))
            let task = URLSession.shared.dataTask(with: origin)
            var decisions = 0
            CompanionRedirectPolicy.shared.urlSession(.shared, task: task, willPerformHTTPRedirection: response, newRequest: target) { request in
                decisions += 1
                XCTAssertNil(request)
            }
            XCTAssertEqual(decisions, 1)
            task.cancel()
        }
    }
}
