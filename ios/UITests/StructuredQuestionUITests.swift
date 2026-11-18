import XCTest

final class StructuredQuestionUITests: XCTestCase {
    @MainActor
    func testAllQuestionsMustBeAnsweredAndMultipleChoicesStaySelected() {
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = [
            "-store-preview", "-structured-question-preview",
            "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
            "-companion.prefs.islandIntro", "never",
            "-companion.onboarding.welcomeSeen", "YES",
            "-companion.onboarding.notificationsSeen", "YES"
        ]
        app.launch()
        let open = app.buttons["question-open-chat"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        let submit = app.buttons["question-submit"]
        XCTAssertTrue(submit.waitForExistence(timeout: 5))
        XCTAssertFalse(submit.isEnabled)
        let basic = app.buttons["Basic"].firstMatch
        let pro = app.buttons["Pro"].firstMatch
        if !basic.isHittable { app.swipeDown() }
        basic.tap()
        pro.tap()
        XCTAssertEqual(basic.value as? String, "Selected")
        XCTAssertEqual(pro.value as? String, "Selected")
        XCTAssertFalse(submit.isEnabled)
        let today = app.buttons["Today"].firstMatch
        if !today.isHittable { app.swipeUp() }
        today.tap()
        XCTAssertTrue(submit.isEnabled)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Structured questions with multiple selections"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
