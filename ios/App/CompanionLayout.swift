// Modified for StartupBot; original copyright and license retained.
import SwiftUI
import UIKit

enum CompanionLayout {
    /// Ask iPadOS for a large landscape window on first launch. The system
    /// clamps this to the current display and still lets the person resize or
    /// tile the app. Previously SwiftUI inferred its initial window from the
    /// 680-point roster column, which produced a tall, phone-like window.
    static let defaultWindowSize = CGSize(width: 1_366, height: 1_024)

    static let rosterWidth: CGFloat = 680
    static let chatWidth: CGFloat = 760
    static let headerWidth: CGFloat = 900

    static var supportsIslandPresentation: Bool {
        UIDevice.current.userInterfaceIdiom == .phone
    }
}
