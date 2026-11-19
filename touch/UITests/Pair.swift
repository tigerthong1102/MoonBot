import XCTest
final class Pair: XCTestCase {
    @MainActor func testConfirmRequestedPhone() {
        let app = XCUIApplication(bundleIdentifier: "ai.startupbot.ios")
        app.activate()
        let button = app.buttons["Kết nối"]
        XCTAssertTrue(button.waitForExistence(timeout: 15))
        button.tap()
    }
}
