// Modified for StartupBot; original copyright and license retained.
import XCTest

@testable import CompanionCore

final class BotAvatarRenderingTests: XCTestCase {
    private func outcome(
        _ crop: AvatarCrop, hasUrl: Bool = true, decoded: Bool = true, failed: Bool = false
    ) -> BotAvatarOutcome {
        resolveBotAvatarOutcome(
            crop: crop, hasUrl: hasUrl, imageDecoded: decoded, failed: failed)
    }

    func testMascotAlwaysDrawsTheGradientBody() {
        XCTAssertEqual(outcome(.mascot), .gradientMascot)
        XCTAssertEqual(outcome(.mascot, hasUrl: false), .gradientMascot)
    }

    func testFlatCropsWearTheImageItself() {
        for crop in [AvatarCrop.circle, .rounded, .square] {
            XCTAssertEqual(outcome(crop), .flatImage, "\(crop) should crop the image")
        }
    }

    func testEveryCropFallsBackToTheGradientMascotWithoutAPicture() {
        for crop in AvatarCrop.allCases {
            XCTAssertEqual(outcome(crop, hasUrl: false), .gradientMascot, "\(crop) with no url")
            XCTAssertEqual(outcome(crop, decoded: false), .gradientMascot, "\(crop) still loading")
            XCTAssertEqual(
                outcome(crop, decoded: false, failed: true), .gradientMascot, "\(crop) failed")
        }
    }

    func testAFailedFetchNeverDrawsTheImage() {
        XCTAssertEqual(outcome(.rounded, failed: true), .gradientMascot)
        XCTAssertEqual(outcome(.circle, failed: true), .gradientMascot)
    }

    func testGeneratingFromAMascotBotTakesTheServersCrop() {
        XCTAssertEqual(
            AvatarCrop.afterGenerating(cropAtStart: .mascot, latestCrop: .mascot, serverCrop: .circle),
            .circle)
    }

    func testMovingThePickerMidFlightWinsOverTheServersPick() {
        XCTAssertEqual(
            AvatarCrop.afterGenerating(cropAtStart: .mascot, latestCrop: .square, serverCrop: .circle),
            .square)
        XCTAssertEqual(
            AvatarCrop.afterGenerating(cropAtStart: .circle, latestCrop: .rounded, serverCrop: .square),
            .rounded)
    }

    func testNoServerCropFallsBackToCircle() {
        XCTAssertEqual(
            AvatarCrop.afterGenerating(cropAtStart: .mascot, latestCrop: .mascot, serverCrop: nil),
            .circle)
    }
}
