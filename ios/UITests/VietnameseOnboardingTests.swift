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
        let freshWelcome = "--startupbot-test-fresh-welcome"
        app.launchArguments.append(freshWelcome)
        app.launch()
        XCTAssertTrue(app.staticTexts["Chào mừng bạn đến với StartupBot"].waitForExistence(timeout: 15))
        #if MOBILE_CHAT_FIXTURE
        app.buttons["Chat không cần máy tính"].tap()
        XCTAssertTrue(app.buttons["Gửi mã qua email"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["Email"].exists)
        app.buttons["mobile-login-cancel"].tap()
        #endif
        XCTAssertTrue(app.buttons["Kết nối với máy tính của tôi"].exists)
        app.buttons["Để sau"].tap()
        XCTAssertTrue(app.buttons["Kết nối máy tính"].waitForExistence(timeout: 8))
        #if MOBILE_CHAT_FIXTURE
        XCTAssertTrue(app.buttons["Chat không cần máy tính"].exists)
        #endif
        app.terminate()
        app.launchArguments.removeAll { $0 == freshWelcome }
        app.launch()
        XCTAssertTrue(app.buttons["Kết nối máy tính"].waitForExistence(timeout: 8))
    }
}
