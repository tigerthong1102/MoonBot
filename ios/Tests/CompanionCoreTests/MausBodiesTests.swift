// Modified for StartupBot; original copyright and license retained.
import CoreGraphics
import XCTest

@testable import CompanionCore

final class MausBodiesTests: XCTestCase {
    func testEveryBodyParsesToAClosedPathInsideTheFaceBox() {
        for id in MausBodies.order {
            let path = MausSilhouette.inFaceBox(id)
            XCTAssertFalse(path.isEmpty, "\(id) parsed to nothing")

            let bounds = MausSilhouette.faceBoxBounds(id)
            XCTAssertGreaterThan(bounds.width, 0, "\(id) has no width")
            XCTAssertGreaterThan(bounds.height, 0, "\(id) has no height")
            XCTAssertGreaterThanOrEqual(bounds.minX, -1, "\(id) overflows the face box to the left")
            XCTAssertGreaterThanOrEqual(bounds.minY, -1, "\(id) overflows the face box above")
            XCTAssertLessThanOrEqual(
                bounds.maxX, MausSilhouette.faceBox + 1, "\(id) overflows the face box to the right")
            XCTAssertLessThanOrEqual(
                bounds.maxY, MausSilhouette.faceBox + 1, "\(id) overflows the face box below")
        }
    }

    func testUnknownBodyFallsBackToTheCursor() {
        XCTAssertEqual(MausBodies.body("hexagram").id, "cursor")
        XCTAssertEqual(MausBodies.body(nil).id, "cursor")
        XCTAssertEqual(MausBodies.body("").id, "cursor")
    }

    func testAnUnknownBodyDrawsTheCursor() {
        XCTAssertEqual(
            MausSilhouette.faceBoxBounds("hexagram"), MausSilhouette.faceBoxBounds("cursor"))
        XCTAssertEqual(MausSilhouette.faceBoxBounds(nil), MausSilhouette.faceBoxBounds("cursor"))

        let unknown = MausSilhouette.anchor("hexagram")
        let cursor = MausSilhouette.anchor("cursor")
        XCTAssertEqual(unknown.x, cursor.x)
        XCTAssertEqual(unknown.y, cursor.y)
        XCTAssertEqual(unknown.scale, cursor.scale)
    }

    func testEveryAnchorPlacesAFaceInsideItsBody() {
        for id in MausBodies.order {
            let anchor = MausSilhouette.anchor(id)
            XCTAssertGreaterThan(anchor.scale, 0, "\(id) has no face")
            XCTAssertLessThanOrEqual(anchor.scale, 1, "\(id) inflates the face")

            let bounds = MausSilhouette.faceBoxBounds(id)
            XCTAssertTrue(
                bounds.insetBy(dx: -1, dy: -1).contains(CGPoint(x: anchor.x, y: anchor.y)),
                "\(id) anchors its face outside its own body")
        }
    }

    func testTheParserUnderstandsTheCatalogsPathGrammar() {
        let square = MausSilhouette.parse(
            """
            M0 0 C0 0 10 0 10 0 C10 0 10 10 10 10
            C10 10 0 10 0 10 C0 10 0 0 0 0Z
            """)
        XCTAssertFalse(square.isEmpty)
        XCTAssertEqual(square.boundingBoxOfPath, CGRect(x: 0, y: 0, width: 10, height: 10))

        let negative = MausSilhouette.parse("M-2.5 0 C-2.5 0 1e1 -5 10 -5Z")
        XCTAssertEqual(negative.boundingBoxOfPath.minX, -2.5, accuracy: 0.0001)
        XCTAssertEqual(negative.boundingBoxOfPath.minY, -5, accuracy: 0.0001)
    }

    func testEachBodyIsParsedOnceAndCachedSeparately() {
        for id in MausBodies.order {
            XCTAssertTrue(
                MausSilhouette.inFaceBox(id) === MausSilhouette.inFaceBox(id),
                "\(id) was parsed twice")
        }
        XCTAssertFalse(MausSilhouette.inFaceBox("cursor") === MausSilhouette.inFaceBox("star"))
    }
}
