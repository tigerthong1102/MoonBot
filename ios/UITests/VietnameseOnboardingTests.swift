// Modified for StartupBot; original copyright and license retained.
import XCTest

final class VietnameseOnboardingTests: XCTestCase {
    @MainActor
    func testVietnameseWelcomeAndUnpairedHome() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.prefs.language", "vi"
        ]
        app.launch()
        XCTAssertTrue(app.staticTexts["Chào mừng bạn đến với StartupBot"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Kết nối với máy tính của tôi"].exists)
        app.buttons["Để sau"].tap()
        XCTAssertTrue(app.buttons["Kết nối máy tính"].waitForExistence(timeout: 8))
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["Kết nối máy tính"].waitForExistence(timeout: 8))
    }
}
