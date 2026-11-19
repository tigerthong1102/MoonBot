import XCTest

final class Pair: XCTestCase {
    @MainActor func testConfirmRequestedPhone() async throws {
        let app = XCUIApplication(bundleIdentifier: "ai.startupbot.ios")
        app.activate()
        var open = URLRequest(url: URL(string: "http://127.0.0.1:19812/open")!)
        open.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: open)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for title in ["Open", "Mở"] {
            let button = springboard.alerts.buttons[title]
            if button.exists { button.tap(); break }
        }
        let button = app.buttons["Kết nối"]
        guard button.waitForExistence(timeout: 20) else {
            XCTFail("No confirmation. Buttons: " + app.buttons.allElementsBoundByIndex.map { $0.label }.joined(separator: ", "))
            return
        }
        if !button.isHittable { app.swipeUp() }
        button.tap()
    }
}
