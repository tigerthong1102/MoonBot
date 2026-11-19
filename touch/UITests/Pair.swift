import XCTest

final class Pair: XCTestCase {
    @MainActor func testConfirmRequestedPhone() throws {
        let launcher = XCUIApplication()
        launcher.launch()
        launcher.buttons["Open StartupBot invitation"].tap()
        let app = XCUIApplication(bundleIdentifier: "ai.startupbot.ios")
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if !app.wait(for: .runningForeground, timeout: 3) {
            let button = springboard.alerts.buttons.matching(NSPredicate(format:"label IN %@", ["Open","Mở"])).firstMatch
            if button.waitForExistence(timeout: 5) { button.tap() }
        }
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15))
        let button = app.buttons["Kết nối"]
        guard button.waitForExistence(timeout: 12) else {
            XCTFail("No confirmation. Buttons: " + app.buttons.allElementsBoundByIndex.map { $0.label }.joined(separator: ", "))
            return
        }
        if !button.isHittable { app.swipeUp() }
        button.tap()
    }
}
