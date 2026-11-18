import Foundation
import XCTest
@testable import CompanionCore

final class StartupBotCompatibilityTests: XCTestCase {
    func testOwnAndLegacyPairingSchemesPreserveCredentialScope() throws {
        for scheme in ["startupbot", "openmausbot"] {
            let url = try XCTUnwrap(URL(string: "\(scheme)://pair?address=192.168.1.20%3A8810&code=123456"))
            let invite = try XCTUnwrap(PairingInvite.parse(url))
            XCTAssertEqual(invite.credential, "123456")
            XCTAssertNil(PairingInvite.parse(try XCTUnwrap(URL(string: "\(scheme)://other?address=192.168.1.20%3A8810&code=123456"))))
            XCTAssertNil(PairingInvite.parse(try XCTUnwrap(URL(string: "\(scheme)://pair?address=192.168.1.20%3A8810&code=123456&code=654321"))))
        }
    }
    func testNativeCredentialEncryptionKeepsThePublishedV1Domain() {
        XCTAssertEqual(PhoneSecretCrypto.info, "OpenMausBot phone credential v1")
    }
    func testUnknownAndDefaultBodiesUseTheStartupBotLogo() {
        XCTAssertTrue(MausSilhouette.usesDefaultBody(nil))
        XCTAssertTrue(MausSilhouette.usesDefaultBody("cursor"))
        XCTAssertTrue(MausSilhouette.usesDefaultBody("unknown"))
        XCTAssertFalse(MausSilhouette.usesDefaultBody("circle"))
    }
}
