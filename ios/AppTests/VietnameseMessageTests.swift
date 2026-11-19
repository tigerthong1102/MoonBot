// Modified for StartupBot; original copyright and license retained.
import XCTest
@testable import StartupBot

final class VietnameseMessageTests: XCTestCase {
    func testPairingErrorsUseTheLanguageChosenInTheApp() {
        let defaults = UserDefaults.standard
        let previous = defaults.object(forKey: PrefKey.language)
        defer {
            if let previous {
                defaults.set(previous, forKey: PrefKey.language)
            } else {
                defaults.removeObject(forKey: PrefKey.language)
            }
        }
        defaults.set("vi", forKey: PrefKey.language)
        XCTAssertEqual(AppLanguage.message("This computer is offline."), "Máy tính này đang ngoại tuyến.")
        defaults.set("en", forKey: PrefKey.language)
        XCTAssertEqual(AppLanguage.message("This computer is offline."), "This computer is offline.")
    }
}
